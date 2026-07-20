import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { BankPanel } from './BankPanel';
import { initTestI18n } from './testI18n';

const FULL_BANK = { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 };

describe('BankPanel (T-402 requirement 3: per-resource remaining + shortage warning, R5.3)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('renders every resource\'s remaining count and the dev deck count', () => {
    const html = renderToStaticMarkup(createElement(BankPanel, { bank: FULL_BANK, devDeckCount: 25 }));
    expect(html).toContain('19 bricks');
    expect(html).toContain('19 lumber');
    expect(html).toContain('19 wool');
    expect(html).toContain('19 grain');
    expect(html).toContain('19 ore');
    expect(html).toContain('25 development cards');
  });

  it('flags a resource at the R5.3 shortage threshold (<=2) with the warn style', () => {
    const html = renderToStaticMarkup(
      createElement(BankPanel, { bank: { ...FULL_BANK, brick: 2 }, devDeckCount: 25 }),
    );
    const brickSpan = html.match(/<span[^>]*data-testid="bank-brick"[^>]*>[^<]*<\/span>/)?.[0] ?? '';
    expect(brickSpan).toContain('text-danger');
  });

  it('does not warn a resource comfortably above the threshold', () => {
    const html = renderToStaticMarkup(createElement(BankPanel, { bank: FULL_BANK, devDeckCount: 25 }));
    const woolSpan = html.match(/<span[^>]*data-testid="bank-wool"[^>]*>[^<]*<\/span>/)?.[0] ?? '';
    expect(woolSpan).not.toContain('text-danger');
  });
});
