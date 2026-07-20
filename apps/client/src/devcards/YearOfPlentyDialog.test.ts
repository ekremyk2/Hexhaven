// Render-layer tests (this workspace's vitest runs under `node`, no jsdom — see
// `apps/client/src/ui/primitives.test.ts`'s header comment — so click simulation isn't available;
// `devCardLogic.test.ts` covers the pure bank-gating arithmetic a real click would drive). This
// file asserts on the static markup the dialog produces from a crafted `bank`: which picks are
// disabled, and whether the confirm button is enabled — mirrors `trade/BankTradeDialog.test.ts`.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ResourceType } from '@hexhaven/shared';
import { YearOfPlentyDialog } from './YearOfPlentyDialog';
import { initDevcardsTestI18n } from './testI18n';
import { isDisabled } from './testHelpers';

const NOOP = () => {};
const ZERO_BANK: Record<ResourceType, number> = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };

describe('YearOfPlentyDialog (task requirement 4)', () => {
  beforeAll(async () => {
    await initDevcardsTestI18n();
  });

  it('renders nothing (Modal closed) when `open` is false', () => {
    const html = renderToStaticMarkup(
      createElement(YearOfPlentyDialog, { open: false, bank: { ...ZERO_BANK, brick: 5 }, onConfirm: NOOP, onClose: NOOP }),
    );
    expect(html).not.toContain('data-testid="year-of-plenty-dialog"');
  });

  it('disables a first-pick resource the bank holds none of', () => {
    const bank = { ...ZERO_BANK, brick: 0, lumber: 3 };
    const html = renderToStaticMarkup(createElement(YearOfPlentyDialog, { open: true, bank, onConfirm: NOOP, onClose: NOOP }));
    expect(isDisabled(html, 'yop-pick-a-brick')).toBe(true);
    expect(isDisabled(html, 'yop-pick-a-lumber')).toBe(false);
  });

  it('confirm starts disabled with nothing picked yet', () => {
    const bank = { ...ZERO_BANK, brick: 5, lumber: 5 };
    const html = renderToStaticMarkup(createElement(YearOfPlentyDialog, { open: true, bank, onConfirm: NOOP, onClose: NOOP }));
    expect(isDisabled(html, 'yop-confirm')).toBe(true);
  });

  it('every resource type is offered for both picks (same type twice is legal, ER-6)', () => {
    const bank = { ...ZERO_BANK, grain: 5 };
    const html = renderToStaticMarkup(createElement(YearOfPlentyDialog, { open: true, bank, onConfirm: NOOP, onClose: NOOP }));
    expect(html).toContain('data-testid="yop-pick-a-grain"');
    expect(html).toContain('data-testid="yop-pick-b-grain"');
    expect(isDisabled(html, 'yop-pick-b-grain')).toBe(false);
  });
});
