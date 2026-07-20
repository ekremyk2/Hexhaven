// Mechanical checks for src/ui/** primitives (T-307 requirement 6: focus-ring presence, Button
// hit-target sizes). Uses `react-dom/server`'s `renderToStaticMarkup` — a pure function that
// produces an HTML string without touching the DOM, so these run under vitest's `node`
// environment with no jsdom/@testing-library dependency (neither is in this task's allowance,
// docs/04 §folder-structure). Effects (Modal's focus-trap/Escape) don't run under static markup —
// those need a live DOM and are left for the /styleguide dev-server manual check (see T-307
// Implementation notes).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { BUTTON_HIT_TARGET_PX, FOCUS_RING_CLASS, MIN_HIT_TARGET_PX, MOBILE_MIN_HIT_TARGET_PX } from './constants';
import { Panel } from './Panel';
import { PlayerChip } from './PlayerChip';
import { SegmentedControl } from './SegmentedControl';
import { TextInput } from './TextInput';
import { Toast } from './Toast';

describe('Button (docs/11 §6: focus ring + hit targets)', () => {
  it('every declared size clears the 24px minimum hit target', () => {
    for (const px of Object.values(BUTTON_HIT_TARGET_PX)) {
      expect(px).toBeGreaterThanOrEqual(MIN_HIT_TARGET_PX);
    }
  });

  // T-506 (mobile-friendly interface): every size is floored at the 44px touch minimum below
  // `md:` and reverts to its exact declared desktop height at `md:` — asserted as Tailwind
  // arbitrary-value classes now that sizing can't be a single non-responsive inline style.
  it.each(['sm', 'md', 'lg'] as const)('renders the %s size at its declared desktop min-height, floored at 44px on mobile', (size) => {
    const html = renderToStaticMarkup(createElement(Button, { size, children: 'x' }));
    const desktopPx = BUTTON_HIT_TARGET_PX[size];
    if (desktopPx >= MOBILE_MIN_HIT_TARGET_PX) {
      expect(html).toContain(`min-h-[${desktopPx}px]`);
    } else {
      expect(html).toContain(`min-h-[${MOBILE_MIN_HIT_TARGET_PX}px]`);
      expect(html).toContain(`md:min-h-[${desktopPx}px]`);
    }
  });

  it.each(['primary', 'subtle', 'danger'] as const)('%s variant carries the shared focus ring', (variant) => {
    const html = renderToStaticMarkup(createElement(Button, { variant, children: 'x' }));
    for (const cls of FOCUS_RING_CLASS.split(' ')) {
      expect(html).toContain(cls);
    }
  });

  it('disabled buttons are marked aria-disabled and not styled as clickable', () => {
    const html = renderToStaticMarkup(createElement(Button, { disabled: true, children: 'x' }));
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('cursor-not-allowed');
  });
});

describe('TextInput (inline-error slot)', () => {
  it('renders no error slot when error is absent', () => {
    const html = renderToStaticMarkup(createElement(TextInput, { label: 'Name' }));
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-invalid="true"');
  });

  it('wires aria-invalid/aria-describedby to a visible role="alert" error slot', () => {
    const html = renderToStaticMarkup(createElement(TextInput, { label: 'Name', error: 'Required' }));
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Required');
  });

  it('carries the shared focus ring', () => {
    const html = renderToStaticMarkup(createElement(TextInput, { label: 'Name' }));
    for (const cls of FOCUS_RING_CLASS.split(' ')) {
      expect(html).toContain(cls);
    }
  });
});

describe('Card / Panel (parchment surfaces, docs/11 §1)', () => {
  it('Card uses the card radius, not the panel radius', () => {
    const html = renderToStaticMarkup(createElement(Card, { children: 'x' }));
    expect(html).toContain('rounded-card');
    expect(html).not.toContain('rounded-panel');
  });

  it('Panel applies the canonical .hexhaven-panel recipe', () => {
    const html = renderToStaticMarkup(createElement(Panel, { children: 'x' }));
    expect(html).toContain('hexhaven-panel');
  });
});

describe('Badge variants', () => {
  it.each(['default', 'gold', 'danger'] as const)('%s variant renders without throwing', (variant) => {
    const html = renderToStaticMarkup(createElement(Badge, { variant, children: 'x' }));
    expect(html).toContain('x');
  });
});

describe('PlayerChip (docs/11 §4: color + shape badge double-coding)', () => {
  it.each([0, 1, 2, 3, 4, 5] as const)('seat %d renders its seat color class and a badge glyph', (seat) => {
    const html = renderToStaticMarkup(createElement(PlayerChip, { seat, name: 'Alice' }));
    expect(html).toContain(`bg-seat-${seat}`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('Alice');
  });

  it('marks the active seat with a distinct ring so turn order is visible without color alone', () => {
    const activeHtml = renderToStaticMarkup(createElement(PlayerChip, { seat: 0, name: 'Alice', active: true }));
    const idleHtml = renderToStaticMarkup(createElement(PlayerChip, { seat: 0, name: 'Alice' }));
    expect(activeHtml).toContain('ring-accent-gold');
    expect(idleHtml).not.toContain('ring-accent-gold');
  });
});

describe('Toast motion (docs/11 §5 "toast/modal enter-exit")', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  function renderToast() {
    return renderToStaticMarkup(
      createElement(Toast, { kind: 'info', message: 'hi', dismissLabel: 'Dismiss', onDismiss: () => {} }),
    );
  }

  it('plays the enter animation by default', () => {
    expect(renderToast()).toContain('hexhaven-toast-enter');
  });

  it('suppresses the enter animation under prefers-reduced-motion', () => {
    (globalThis as { window?: unknown }).window = {
      matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
    };
    const html = renderToast();
    expect(html).not.toContain('hexhaven-toast-enter');
    expect(html).not.toContain('hexhaven-toast-exit');
  });
});

describe('SegmentedControl (radiogroup semantics)', () => {
  const options = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ];

  it('marks exactly the selected option aria-checked', () => {
    const html = renderToStaticMarkup(
      createElement(SegmentedControl, { options, value: 'b', onChange: () => {}, ariaLabel: 'demo' }),
    );
    expect(html).toContain('role="radiogroup"');
    // Two radio buttons: option "a" false, option "b" true — assert both states are present once.
    expect(html.match(/aria-checked="true"/g)?.length).toBe(1);
    expect(html.match(/aria-checked="false"/g)?.length).toBe(1);
  });
});
