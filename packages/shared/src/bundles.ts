// Pure bundle helper functions (docs/03 §2)

import type { ResourceBundle } from './constants.js';

/**
 * Sum all resources in a bundle
 */
export function bundleTotal(b: ResourceBundle): number {
  return Object.values(b).reduce((sum, count) => sum + (count ?? 0), 0);
}

/**
 * Add two bundles element-wise
 */
export function addBundles(a: ResourceBundle, b: ResourceBundle): ResourceBundle {
  const result = { ...a };
  for (const [resource, count] of Object.entries(b)) {
    const key = resource as keyof ResourceBundle;
    result[key] = (result[key] ?? 0) + (count ?? 0);
  }
  return result;
}

/**
 * Subtract bundle b from bundle a; throws BUG: if any result is negative
 */
export function subtractBundles(a: ResourceBundle, b: ResourceBundle): ResourceBundle {
  const result = { ...a };
  for (const [resource, count] of Object.entries(b)) {
    const key = resource as keyof ResourceBundle;
    const newCount = (result[key] ?? 0) - (count ?? 0);
    if (newCount < 0) {
      throw new Error(`BUG: negative bundle result for ${resource}`);
    }
    result[key] = newCount === 0 ? undefined : newCount;
  }
  return result;
}

/**
 * Check if hand has at least the resources in bundle
 */
export function hasAtLeast(hand: ResourceBundle, bundle: ResourceBundle): boolean {
  for (const [resource, required] of Object.entries(bundle)) {
    const key = resource as keyof ResourceBundle;
    if ((hand[key] ?? 0) < (required ?? 0)) {
      return false;
    }
  }
  return true;
}
