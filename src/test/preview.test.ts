import { test } from "node:test";
import assert from "node:assert/strict";
import {
  repoSlug,
  previewUrlOf,
  pickPreviewUrl,
  handleWebhookEvent,
} from "../core/preview.js";
import { initStore, createTask, updateTask, getTask, closeStore } from "../core/store.js";

test("repoSlug normalizes slug, https and ssh specs", () => {
  assert.equal(repoSlug("owner/repo"), "owner/repo");
  assert.equal(repoSlug("owner/repo.git"), "owner/repo");
  assert.equal(repoSlug("https://github.com/owner/repo"), "owner/repo");
  assert.equal(repoSlug("git@github.com:owner/repo.git"), "owner/repo");
  assert.equal(repoSlug("not-a-repo"), null);
});

test("previewUrlOf: success + non-prod + has url; environment_url wins", () => {
  assert.equal(
    previewUrlOf({ state: "success", environment_url: "https://x.preview", target_url: "https://t" }),
    "https://x.preview"
  );
  assert.equal(previewUrlOf({ state: "success", target_url: "https://t" }), "https://t");
  // excluded: failed, production, or no url
  assert.equal(previewUrlOf({ state: "failure", environment_url: "https://x" }), null);
  assert.equal(previewUrlOf({ state: "success", environment: "Production", environment_url: "https://x" }), null);
  assert.equal(previewUrlOf({ state: "success" }), null);
});

test("pickPreviewUrl returns the first usable status", () => {
  assert.equal(
    pickPreviewUrl([
      { state: "pending" },
      { state: "success", environment: "Production", target_url: "https://prod" },
      { state: "success", environment: "preview", environment_url: "https://ok.preview" },
    ]),
    "https://ok.preview"
  );
  assert.equal(pickPreviewUrl([]), null);
});

test("handleWebhookEvent matches a task by head sha and records the URL", () => {
  initStore(":memory:");
  const task = createTask({ repo: "owner/repo", prompt: "x" });
  updateTask(task.id, { headSha: "abc123" });

  // wrong sha -> no match
  assert.equal(
    handleWebhookEvent("deployment_status", {
      deployment: { sha: "deadbeef", environment: "preview" },
      deployment_status: { state: "success", environment_url: "https://nope" },
      repository: { full_name: "owner/repo" },
    }),
    false
  );

  // production env -> ignored even on the right sha
  assert.equal(
    handleWebhookEvent("deployment_status", {
      deployment: { sha: "abc123", environment: "Production" },
      deployment_status: { state: "success", environment_url: "https://prod" },
      repository: { full_name: "owner/repo" },
    }),
    false
  );

  // right sha + preview success -> recorded
  assert.equal(
    handleWebhookEvent("deployment_status", {
      deployment: { sha: "abc123", environment: "preview" },
      deployment_status: { state: "success", environment_url: "https://app.preview" },
      repository: { full_name: "owner/repo" },
    }),
    true
  );
  assert.equal(getTask(task.id)?.previewUrl, "https://app.preview");

  // idempotent: a second event does not overwrite / re-fire
  assert.equal(
    handleWebhookEvent("deployment_status", {
      deployment: { sha: "abc123", environment: "preview" },
      deployment_status: { state: "success", environment_url: "https://other.preview" },
      repository: { full_name: "owner/repo" },
    }),
    false
  );
  assert.equal(getTask(task.id)?.previewUrl, "https://app.preview");
  closeStore();
});
