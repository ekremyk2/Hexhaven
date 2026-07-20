import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ResourceType } from '@hexhaven/shared';
import { DiscardModal } from './DiscardModal';
import { initTestI18n } from './testI18n';

const HAND: Record<ResourceType, number> = { brick: 3, lumber: 0, wool: 2, grain: 1, ore: 5 };

describe('DiscardModal (requirement 1: blocking discard picker)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      createElement(DiscardModal, { open: false, required: 4, hand: HAND, onConfirm: () => {} }),
    );
    expect(html).toBe('');
  });

  it('shows the owed count in the title and the 0/N counter on a fresh open', () => {
    const html = renderToStaticMarkup(
      createElement(DiscardModal, { open: true, required: 4, hand: HAND, onConfirm: () => {} }),
    );
    expect(html).toContain('Discard 4 cards');
    expect(html).toContain('0 / 4 selected');
  });

  it("caps each resource row's stepper by the hand — a 0-count resource's + button is disabled", () => {
    const html = renderToStaticMarkup(
      createElement(DiscardModal, { open: true, required: 4, hand: HAND, onConfirm: () => {} }),
    );
    const woolRow = html.slice(html.indexOf('data-testid="discard-row-lumber"'));
    // lumber's hand count is 0, so BOTH its stepper buttons render disabled from the start.
    const lumberButtons = woolRow.slice(0, woolRow.indexOf('data-testid="discard-row-wool"'));
    expect((lumberButtons.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('confirm starts disabled (0 selected != required)', () => {
    const html = renderToStaticMarkup(
      createElement(DiscardModal, { open: true, required: 4, hand: HAND, onConfirm: () => {} }),
    );
    const confirmButton = html.slice(html.indexOf('data-testid="discard-confirm"'));
    expect(confirmButton.slice(0, confirmButton.indexOf('>'))).toContain('disabled');
  });
});
