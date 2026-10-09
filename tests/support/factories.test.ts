import { describe, expect, it } from 'vitest';
import { fakeEmail, kebabName, uniqueSuffix } from './factories.js';

describe('factories', () => {
  it('produces unique suffixes across many calls', () => {
    const values = new Set(Array.from({ length: 500 }, () => uniqueSuffix()));

    expect(values.size).toBe(500);
  });

  it('produces kebab-case names usable as domain names', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(kebabName('finance')).toMatch(/^finance(-[a-z0-9]+)+$/);
    }
  });

  it('produces emails on the reserved .test domain', () => {
    expect(fakeEmail()).toMatch(/^user-[a-z0-9-]+@example\.test$/);
  });
});
