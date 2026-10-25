import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CustodyDecision, CustodyRequester, KeyCustodyProvider, SensitiveOperation } from './key-custody-provider.js';

// Story 2.8, AC 2 (Test Design P1-011): the Custodian port takes data only, never an HTTP request.
// The type assertions fail `pnpm typecheck`, not `vitest run`.

describe('KeyCustodyProvider contract', () => {
  it('takes only the data of the operation: exact parameters and fields', () => {
    expectTypeOf<Parameters<KeyCustodyProvider['requestAccess']>>().toEqualTypeOf<[SensitiveOperation]>();
    expectTypeOf<Parameters<KeyCustodyProvider['decisionOf']>>().toEqualTypeOf<[string, SensitiveOperation]>();
    expectTypeOf<ReturnType<KeyCustodyProvider['requestAccess']>>().toEqualTypeOf<Promise<CustodyDecision>>();
    expectTypeOf<ReturnType<KeyCustodyProvider['decisionOf']>>().toEqualTypeOf<Promise<CustodyDecision | undefined>>();
    expectTypeOf<keyof SensitiveOperation>().toEqualTypeOf<'domain' | 'action' | 'resource' | 'tenant' | 'requestedBy' | 'reason'>();
    expectTypeOf<keyof CustodyRequester>().toEqualTypeOf<'kind' | 'subject' | 'via'>();
    expectTypeOf<keyof KeyCustodyProvider>().toEqualTypeOf<'requestAccess' | 'decisionOf'>();
  });

  it('has three decisions: approved, pending with a request id, denied', () => {
    expectTypeOf<CustodyDecision['status']>().toEqualTypeOf<'approved' | 'pending' | 'denied'>();
    expectTypeOf<Extract<CustodyDecision, { status: 'pending' }>>().toEqualTypeOf<{ status: 'pending'; requestId: string }>();
  });

  it('documents where to intercept and imports nothing', () => {
    const source = readFileSync(new URL('./key-custody-provider.ts', import.meta.url), 'utf8');

    expect(source).toContain('at the level of data access, never only in an HTTP route middleware');
    expect(source).not.toMatch(/^import /m);
  });
});
