import { faker } from '@faker-js/faker';

/**
 * Synthetic data helpers shared by every package's tests. Domain-specific factories
 * (credentials, tenants, users, manifests) are added by the stories that introduce
 * those entities, next to this file.
 *
 * Every value carries a unique suffix so parallel tests never collide.
 */

let counter = 0;

export function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}${faker.string.alphanumeric({ length: 4, casing: 'lower' })}`;
}

/** A kebab-case name, valid as a Tecton domain name (e.g. `brave-otter-lq3k1a9x`). */
export function kebabName(prefix?: string): string {
  const words = [faker.word.adjective(), faker.word.noun()]
    .map((word) => word.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    .join('-');
  const base = prefix ? `${prefix}-${words}` : words;
  return `${base}-${uniqueSuffix()}`.replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function fakeEmail(): string {
  return `${kebabName('user')}@example.test`;
}
