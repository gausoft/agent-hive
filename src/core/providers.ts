/**
 * Provider resolution shared across the runtime.
 *
 * Extracted from sessions/manager.ts so the core runner does not depend on the
 * HTTP/session layer.
 */

/** OpenAI-compatible providers we can auto-register from an env API key. */
export const PROVIDER_CONFIGS: Record<
  string,
  { envKey: string; baseUrl: string }
> = {
  openrouter: {
    envKey: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  "opencode-go": {
    envKey: "OPENCODE_GO_API_KEY",
    baseUrl: "https://opencode.ai/zen/go/v1",
  },
  zai: { envKey: "ZAI_CODE", baseUrl: "https://api.z.ai/api/coding/paas/v4" },
  deepseek: {
    envKey: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com/v1",
  },
};

/**
 * Resolve the provider to use:
 * explicit arg > DEFAULT_PROVIDER env > first available key > openrouter.
 */
export function resolveProvider(explicit?: string): string {
  return (
    explicit ||
    process.env.DEFAULT_PROVIDER ||
    (process.env.OPENCODE_GO_API_KEY ? "opencode-go" : undefined) ||
    (process.env.ZAI_CODE ? "zai" : undefined) ||
    (process.env.DEEPSEEK_API_KEY ? "deepseek" : undefined) ||
    (process.env.OPENROUTER_API_KEY ? "openrouter" : undefined) ||
    (process.env.ANTHROPIC_API_KEY ? "anthropic" : undefined) ||
    "openrouter"
  );
}
