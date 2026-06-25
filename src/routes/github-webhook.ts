/**
 * GitHub webhook receiver for deploy-platform preview URLs.
 *
 * Public route (no Bearer): authenticated by HMAC over the raw body using
 * GITHUB_WEBHOOK_SECRET, the standard `X-Hub-Signature-256` scheme. Encapsulated
 * in its own plugin so the raw-buffer content-type parser stays local and does
 * not affect the JSON-parsing rest of the app.
 *
 * Point a repo (or the Hive GitHub App) webhook at POST /api/github/webhook,
 * content type application/json, events: Deployment statuses + Statuses.
 */

import type { FastifyInstance } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { handleWebhookEvent } from "../core/preview.js";

function verify(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected =
    "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function githubWebhookRoute(app: FastifyInstance) {
  // Keep the raw body (HMAC must hash the exact bytes GitHub signed). Local to
  // this encapsulated plugin only.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body)
  );

  app.post("/api/github/webhook", async (req, reply) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) return reply.code(503).send({ error: "webhook secret not configured" });

    const raw = req.body as Buffer;
    const sig = req.headers["x-hub-signature-256"] as string | undefined;
    if (!Buffer.isBuffer(raw) || !verify(raw, sig, secret)) {
      return reply.code(401).send({ error: "invalid signature" });
    }

    const event = (req.headers["x-github-event"] as string) || "";
    let payload: any;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return reply.code(400).send({ error: "invalid json" });
    }

    const updated = handleWebhookEvent(event, payload);
    return reply.send({ ok: true, updated });
  });
}
