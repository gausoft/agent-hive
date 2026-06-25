/**
 * GitHub webhook receiver for deploy-platform preview URLs.
 *
 * Public route (no Bearer): authenticated by HMAC over the raw body using
 * GITHUB_WEBHOOK_SECRET, the standard `X-Hub-Signature-256` scheme. The raw body
 * is captured by the app-level JSON content-type parser (index.ts) as
 * `req.rawBody`, so this route reuses it instead of registering its own parser
 * (which would collide with the global one).
 *
 * Point a repo (or the Hive GitHub App) webhook at POST /api/github/webhook,
 * content type application/json, events: Deployment statuses + Statuses.
 */

import type { FastifyInstance } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { handleWebhookEvent } from "../core/preview.js";

function verify(raw: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected =
    "sha256=" + createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function githubWebhookRoute(app: FastifyInstance) {
  app.post("/api/github/webhook", async (req, reply) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) return reply.code(503).send({ error: "webhook secret not configured" });

    const raw = (req as any).rawBody as string | undefined;
    const sig = req.headers["x-hub-signature-256"] as string | undefined;
    if (!raw || !verify(raw, sig, secret)) {
      return reply.code(401).send({ error: "invalid signature" });
    }

    const event = (req.headers["x-github-event"] as string) || "";
    const payload = req.body; // already parsed by the global JSON parser
    if (!payload) return reply.code(400).send({ error: "invalid json" });

    const updated = handleWebhookEvent(event, payload);
    return reply.send({ ok: true, updated });
  });
}
