import { describe, expect, it } from 'vitest';
import { MAX_CHAT_LENGTH, sanitizeChatInput } from './chatInput';

describe('sanitizeChatInput (T-407 requirement 3: 300-char cap, no blank sends)', () => {
  it('trims surrounding whitespace', () => {
    expect(sanitizeChatInput('  hello  ')).toBe('hello');
  });

  it('returns null for an empty string', () => {
    expect(sanitizeChatInput('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(sanitizeChatInput('   \t  ')).toBeNull();
  });

  it('caps at MAX_CHAT_LENGTH characters', () => {
    const long = 'x'.repeat(400);
    const result = sanitizeChatInput(long);
    expect(result).toHaveLength(MAX_CHAT_LENGTH);
    expect(result).toBe('x'.repeat(MAX_CHAT_LENGTH));
  });

  it('leaves a message under the cap untouched (besides trimming)', () => {
    expect(sanitizeChatInput('gg well played')).toBe('gg well played');
  });
});
