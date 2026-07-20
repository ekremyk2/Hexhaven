import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { MonopolyDialog } from './MonopolyDialog';
import { initDevcardsTestI18n } from './testI18n';
import { isDisabled } from './testHelpers';

const NOOP = () => {};

describe('MonopolyDialog (task requirement 4: single pick, drama-red confirm)', () => {
  beforeAll(async () => {
    await initDevcardsTestI18n();
  });

  it('renders nothing (Modal closed) when `open` is false', () => {
    const html = renderToStaticMarkup(createElement(MonopolyDialog, { open: false, onConfirm: NOOP, onClose: NOOP }));
    expect(html).not.toContain('data-testid="monopoly-dialog"');
  });

  it('offers every resource type and starts with the confirm button disabled', () => {
    const html = renderToStaticMarkup(createElement(MonopolyDialog, { open: true, onConfirm: NOOP, onClose: NOOP }));
    expect(html).toContain('data-testid="monopoly-pick-brick"');
    expect(html).toContain('data-testid="monopoly-pick-ore"');
    expect(isDisabled(html, 'monopoly-confirm')).toBe(true);
  });

  it('the confirm button uses the "danger" (red) variant', () => {
    const html = renderToStaticMarkup(createElement(MonopolyDialog, { open: true, onConfirm: NOOP, onClose: NOOP }));
    expect(html).toContain('bg-danger');
  });
});
