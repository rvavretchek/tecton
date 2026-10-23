import { closeValkeyClient, createValkeyClient, createValkeyLoginLockout, waitForValkeyReady } from '@tecton/providers';
import { startValkey, type StartedValkey } from '#test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CliIo } from '../io.js';
import { authUnlockCommand } from './auth-unlock.js';

// Story 2.6 review P1: the real command, with its real Valkey client, against a real Valkey.
// Runs with `pnpm test:containers` (CI job "containers").
describe('tecton-admin auth unlock against a real Valkey', () => {
  let valkey: StartedValkey;
  const url = () => `redis://${valkey.host}:${valkey.port}`;

  beforeAll(async () => {
    valkey = await startValkey();
  }, 240_000);

  afterAll(async () => {
    await valkey?.stop();
  });

  it('removes a real lock, waiting for the connection before sending the command', async () => {
    const client = createValkeyClient({ url: url() });
    try {
      expect(await waitForValkeyReady(client, 10_000)).toBe(true);
      const lockout = createValkeyLoginLockout({ client, shared: true, maxFailures: 2 });
      await lockout.recordFailure('alice@example.com');
      await lockout.recordFailure('alice@example.com');
      expect(await lockout.check('alice@example.com')).toMatchObject({ locked: true });

      let stdout = '';
      let stderr = '';
      const io: CliIo = {
        cwd: process.cwd(),
        env: { TECTON_VALKEY_URL: url() },
        stdout: { write: (text: string) => void (stdout += text) },
        stderr: { write: (text: string) => void (stderr += text) },
      };

      expect(await authUnlockCommand('Alice@Example.com', io), stderr).toBe(0);
      expect(stdout).toContain('Unlocked "alice@example.com"');
      expect(await lockout.check('alice@example.com')).toEqual({ locked: false });
    } finally {
      await closeValkeyClient(client);
    }
  }, 60_000);
});
