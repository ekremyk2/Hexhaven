// Pure chat-input validation (T-407 requirement 3: 300-char cap, no blank sends). Extracted so
// it's unit-testable without simulating DOM typing (no jsdom in this repo's test environment —
// see vitest.config.ts's `environment: "node"`).
export const MAX_CHAT_LENGTH = 300;

/** Trims and caps the raw draft; returns `null` when there is nothing worth sending (blank or
 * whitespace-only after trimming). */
export function sanitizeChatInput(raw: string): string | null {
  const trimmed = raw.trim().slice(0, MAX_CHAT_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}
