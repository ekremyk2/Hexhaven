// "Report a bug" affordance shared by the lobby and the in-game HUD. This is a STATIC client
// (deployed to GitHub Pages), so it MUST NOT hold a GitHub token or call the GitHub API — the only
// safe channel is a prefilled "New issue" URL that the reporter (already logged into GitHub) opens
// and submits themselves. `buildIssueUrl` is a pure URL assembler (no DOM/i18n reads) so it can be
// unit-tested under vitest's node environment; the component collects env + translations and hands
// them in.
import { useTranslation } from 'react-i18next';
import { Button, type ButtonSize, type ButtonVariant } from '../ui';

/** Repo the prefilled issues open against. Named const per spec so the target lives in one place. */
export const HEXHAVEN_ISSUES_BASE = 'https://github.com/ekremyk2/Hexhaven/issues/new';

/** A bag of diagnostic key→value pairs. Nullish / blank values are dropped from the rendered body. */
export type DetailMap = Record<string, string | number | null | undefined>;

export interface BuildIssueUrlOptions {
  /** Which screen the report was opened from ("lobby" / "game"); also seeds the default title. */
  screen: string;
  /** Caller-supplied diagnostics (roomCode, gameId, …) merged OVER the auto-collected `env`. */
  details?: DetailMap;
  /** The GitHub issue title. Callers pass the translated string; falls back to an English default. */
  title?: string;
  /** Short reproduction template placed above the diagnostics section. */
  template?: string;
  /** Heading for the diagnostics bullet list. */
  diagnosticsHeading?: string;
  /** Auto-collected environment map (see `collectEnv`), merged UNDER `details`. */
  env?: DetailMap;
}

function bulletsFrom(map: DetailMap): string[] {
  return Object.entries(map)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim().length > 0)
    .map(([key, value]) => `- **${key}**: ${String(value)}`);
}

/**
 * Assemble a prefilled GitHub "New issue" URL. Pure: no `window`, no `t()`, no `Date` — everything
 * it needs is passed in, so it runs unchanged under node (the unit test) and the browser.
 */
export function buildIssueUrl({ screen, details, title, template, diagnosticsHeading, env }: BuildIssueUrlOptions): string {
  const merged: DetailMap = { ...(env ?? {}), ...(details ?? {}) };
  const heading = diagnosticsHeading ?? 'Diagnostics';
  const bodyParts: string[] = [];
  if (template) bodyParts.push(template);
  bodyParts.push(`## ${heading}`, bulletsFrom(merged).join('\n'));
  const body = bodyParts.join('\n\n');
  const issueTitle = title ?? `Bug report — ${screen}`;

  const query = [
    'labels=bug',
    `title=${encodeURIComponent(issueTitle)}`,
    `body=${encodeURIComponent(body)}`,
  ].join('&');
  return `${HEXHAVEN_ISSUES_BASE}?${query}`;
}

/**
 * Best-effort environment snapshot for the diagnostics section. Reads `window`/`navigator` guardedly
 * so it degrades gracefully off the browser. `Date` is fine here — the no-`Date` rule binds the
 * ENGINE only; this is client code.
 */
export function collectEnv(screen: string, language?: string): DetailMap {
  const env: DetailMap = { screen };
  if (language) env.language = language;
  if (typeof window !== 'undefined') {
    env.url = window.location.href;
    env.viewport = `${window.innerWidth}×${window.innerHeight}`;
  }
  if (typeof navigator !== 'undefined') env.userAgent = navigator.userAgent;
  env.time = new Date().toISOString();
  return env;
}

export interface BugReportButtonProps {
  screen: string;
  details?: DetailMap;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

/**
 * Design-system `Button` that opens a prefilled GitHub issue in a new tab. `Button` omits
 * `className`, so any layout must come from a wrapper the caller supplies — never a className here.
 */
export function BugReportButton({ screen, details, size = 'sm', variant = 'subtle' }: BugReportButtonProps) {
  const { t, i18n } = useTranslation('common');

  function openReport() {
    const url = buildIssueUrl({
      screen,
      details,
      title: t('bugReport.defaultTitle', { screen }),
      template: t('bugReport.template'),
      diagnosticsHeading: t('bugReport.diagnosticsHeading'),
      env: collectEnv(screen, i18n.resolvedLanguage),
    });
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <Button
      variant={variant}
      size={size}
      data-testid="bug-report-button"
      title={t('bugReport.title')}
      onClick={openReport}
    >
      {t('bugReport.button')}
    </Button>
  );
}
