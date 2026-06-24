/**
 * Centralized token validation, shared by HTTP and WebSocket auth.
 *
 * Supports two configurations:
 *  - API_TOKENS: a JSON map of token -> { name, role } (multi-user)
 *  - API_TOKEN:  a single token (backwards compatible)
 *
 * API_TOKENS takes precedence when both are set.
 */

export interface UserProfile {
  name: string;
  role: string;
}

let cache: Record<string, UserProfile> | null = null;

function loadTokens(): Record<string, UserProfile> {
  const tokens: Record<string, UserProfile> = {};

  if (process.env.API_TOKENS) {
    try {
      const parsed = JSON.parse(process.env.API_TOKENS) as Record<
        string,
        { name: string; role?: string }
      >;
      for (const [token, profile] of Object.entries(parsed)) {
        tokens[token] = { name: profile.name, role: profile.role || "user" };
      }
    } catch {
      console.warn(
        "Failed to parse API_TOKENS, falling back to single API_TOKEN"
      );
    }
  }

  if (!Object.keys(tokens).length && process.env.API_TOKEN) {
    tokens[process.env.API_TOKEN] = { name: "Admin", role: "admin" };
  }

  return tokens;
}

/** Returns the token map, parsed once and memoized. */
export function getTokens(): Record<string, UserProfile> {
  if (!cache) cache = loadTokens();
  return cache;
}

/** Resolve a token to its profile, or null if unknown. */
export function validateToken(
  token: string | undefined | null
): UserProfile | null {
  if (!token) return null;
  return getTokens()[token] ?? null;
}

/** True if at least one token is configured. */
export function hasAnyToken(): boolean {
  return Object.keys(getTokens()).length > 0;
}

/** Reset the memoized token cache (used by tests). */
export function resetTokenCache(): void {
  cache = null;
}
