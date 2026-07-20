// Unit tests for the pure `buildIssueUrl` assembler. No DOM: vitest runs under node here, so these
// exercise only the pure function (the component's window.open path is not tested).
import { describe, expect, it } from 'vitest';
import { HEXHAVEN_ISSUES_BASE, buildIssueUrl } from './BugReportButton';

describe('buildIssueUrl', () => {
  it('targets the ekremyk2/Hexhaven new-issue endpoint', () => {
    const url = buildIssueUrl({ screen: 'lobby' });
    expect(url.startsWith(`${HEXHAVEN_ISSUES_BASE}?`)).toBe(true);
    const parsed = new URL(url);
    expect(parsed.host).toBe('github.com');
    expect(parsed.pathname).toBe('/ekremyk2/Hexhaven/issues/new');
  });

  it('always tags the issue with the bug label', () => {
    const url = buildIssueUrl({ screen: 'game' });
    // Assert the raw, un-decoded query so we prove the literal `labels=bug` pair is present.
    expect(url).toContain('labels=bug');
    expect(new URL(url).searchParams.get('labels')).toBe('bug');
  });

  it('URL-encodes the title and body (no raw spaces in the query)', () => {
    const url = buildIssueUrl({
      screen: 'game',
      title: 'Bug report — game',
      template: 'What you did:\nWhat you expected:\nWhat happened:',
    });
    const query = url.slice(url.indexOf('?') + 1);
    expect(query).not.toContain(' ');
    expect(query).not.toContain('\n');
    // Encoded on the wire, but round-trips cleanly back to the originals.
    const parsed = new URL(url);
    expect(parsed.searchParams.get('title')).toBe('Bug report — game');
    expect(parsed.searchParams.get('body')).toContain('What you expected:');
  });

  it('includes non-empty details in the decoded body and omits empty/nullish ones', () => {
    const url = buildIssueUrl({
      screen: 'game',
      details: { gameId: 'g1', roomCode: '', missing: null, blank: undefined },
    });
    const body = new URL(url).searchParams.get('body') ?? '';
    expect(body).toContain('gameId');
    expect(body).toContain('g1');
    // Empty string, null and undefined details must not surface as bullets.
    expect(body).not.toContain('roomCode');
    expect(body).not.toContain('missing');
    expect(body).not.toContain('blank');
  });

  it('merges auto env under caller details (details win on key clash)', () => {
    const url = buildIssueUrl({
      screen: 'game',
      env: { screen: 'game', language: 'en' },
      details: { gameId: 'g1' },
    });
    const body = new URL(url).searchParams.get('body') ?? '';
    expect(body).toContain('language');
    expect(body).toContain('gameId');
  });
});
