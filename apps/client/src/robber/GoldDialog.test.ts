// T-705: the Seafarers gold-field picker (S9/ER-S7). Same node-env / renderToStaticMarkup approach
// as DiscardModal.test.ts — asserts the blocking picker renders for the owed count and caps each
// resource by the bank. `computeGoldDialogState` (the open/required/bank decision) is covered in
// robberLogic.test.ts.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ResourceType } from '@hexhaven/shared';
import { GoldDialog, canIncrementGold } from './GoldDialog';
import { initTestI18n } from './testI18n';

const BANK: Record<ResourceType, number> = { brick: 5, lumber: 0, wool: 3, grain: 2, ore: 4 };

describe('GoldDialog (Seafarers gold-field picker)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      createElement(GoldDialog, { open: false, required: 2, bank: BANK, onConfirm: () => {} }),
    );
    expect(html).toBe('');
  });

  it('shows the owed count in the title and the 0/N counter on a fresh open', () => {
    const html = renderToStaticMarkup(
      createElement(GoldDialog, { open: true, required: 2, bank: BANK, onConfirm: () => {} }),
    );
    expect(html).toContain('Choose 2 gold resource(s)');
    expect(html).toContain('0 / 2 selected');
  });

  it("caps each resource by the bank — a bank-empty resource's + button is disabled", () => {
    const html = renderToStaticMarkup(
      createElement(GoldDialog, { open: true, required: 2, bank: BANK, onConfirm: () => {} }),
    );
    // lumber's bank stock is 0, so both of its stepper buttons render disabled from the start.
    const lumberRow = html.slice(html.indexOf('data-testid="gold-row-lumber"'));
    const lumberButtons = lumberRow.slice(0, lumberRow.indexOf('data-testid="gold-row-wool"'));
    expect((lumberButtons.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('confirm starts disabled (0 selected != required)', () => {
    const html = renderToStaticMarkup(
      createElement(GoldDialog, { open: true, required: 2, bank: BANK, onConfirm: () => {} }),
    );
    const confirmButton = html.slice(html.indexOf('data-testid="gold-confirm"'));
    expect(confirmButton.slice(0, confirmButton.indexOf('>'))).toContain('disabled');
  });
});

describe('canIncrementGold — total-aware + gating (over-select fix)', () => {
  const required = 2;
  const cap = required; // bank not limiting

  it('allows incrementing while under the total and per-resource cap', () => {
    expect(canIncrementGold(0, cap, 0, required)).toBe(true);
    expect(canIncrementGold(1, cap, 1, required)).toBe(true);
  });

  it('blocks ALL + once the running total reaches the owed count — even a resource still under its own cap', () => {
    // The reported bug: total already 2 (e.g. wool=2, or wool=1+brick=1), yet a resource under its
    // per-resource cap could still be bumped → 2+2 = 4 for a "pick 2" roll. Now the total gates it.
    expect(canIncrementGold(0, cap, required, required)).toBe(false);
    expect(canIncrementGold(1, cap, required, required)).toBe(false);
  });

  it('still blocks a resource at its own bank/owed cap even when the total is not yet met', () => {
    expect(canIncrementGold(2, 2, 1, 3)).toBe(false); // count === cap
    expect(canIncrementGold(1, 1, 0, 3)).toBe(false); // bank-limited cap of 1 reached
  });
});
