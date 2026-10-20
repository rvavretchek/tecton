import { describe, expect, it } from 'vitest';
import { isWriteConflict } from './client.js';

function prismaError(message: string, extra: Record<string, unknown> = {}, name = 'PrismaClientKnownRequestError'): Error {
  const error = new Error(message);
  Object.defineProperty(error, 'name', { value: name });
  return Object.assign(error, extra);
}

describe('isWriteConflict (Story 2.3, concurrent rotation)', () => {
  it.each([
    ['Prisma P2034', { code: 'P2034' }],
    ['a driver adapter TransactionWriteConflict', { cause: { kind: 'TransactionWriteConflict' } }],
    ['a PostgreSQL serialization failure', { cause: { originalCode: '40001' } }],
    ['a PostgreSQL deadlock', { meta: { driverAdapterError: { cause: { originalCode: '40P01' } } } }],
    ['a MySQL/MariaDB deadlock', { meta: { driverAdapterError: { cause: { kind: 'mysql', code: 1213 } } } }],
    ['a MariaDB snapshot conflict', { meta: { driverAdapterError: { cause: { kind: 'mysql', code: 1020 } } } }],
  ])('recognizes %s', (_label, shape) => {
    expect(isWriteConflict(shape)).toBe(true);
  });

  it('recognizes the code in the message of a Prisma request error (MariaDB 1020, as seen in CI)', () => {
    const message = "Invalid `tokens(tx).updateMany()` invocation:\n\nDatabase error. Code: `1020`. Message: `Record has changed since last read in table 'refresh_tokens'; try restarting transaction`";

    expect(isWriteConflict(prismaError(message))).toBe(true);
    expect(isWriteConflict(prismaError(message, {}, 'PrismaClientUnknownRequestError'))).toBe(true);
    expect(isWriteConflict(prismaError(message, {}, 'PrismaClientValidationError'))).toBe(false);
  });

  it.each([
    ['a unique violation', prismaError('Unique constraint failed', { code: 'P2002' })],
    ['another database error', prismaError('Database error. Code: `1146`. Message: `Table does not exist`')],
    ['the same code in a plain error', new Error('Code: `1020`')],
    ['a non-mysql code 1020', { cause: { kind: 'other', code: 1020 } }],
    ['nothing', undefined],
  ])('does not mistake %s for a conflict', (_label, error) => {
    expect(isWriteConflict(error)).toBe(false);
  });

  it('stops on cyclic or very deep errors', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['cause'] = cyclic;

    expect(isWriteConflict(cyclic)).toBe(false);
  });
});
