// Keep the browser alive long enough to receive the server's final timeout error.
// A turn can include planning, search, synthesis, review, and one revision.
export const AGENT_TIMEOUT_MS = 600_000;
export const CLIENT_TIMEOUT_MS = AGENT_TIMEOUT_MS + 10_000;
export const DEFAULT_MODEL_TIMEOUT_MS = 180_000;
export const SEARCH_TIMEOUT_MS = 45_000;
