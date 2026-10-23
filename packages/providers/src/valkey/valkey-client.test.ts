import { describe, expect, it } from 'vitest';
import { closeValkeyClient, ValkeyConfigError, valkeyClientFromEnv, waitForValkeyReady } from './valkey-client.js';

describe('Valkey client from the environment (Story 2.6 review)', () => {
  it('names every use of TECTON_VALKEY_URL when it is missing (P10)', () => {
    expect(() => valkeyClientFromEnv({})).toThrow(/^TECTON_VALKEY_URL is not set; point it to the Valkey of the services \(token revocation, login lockout\)$/);
  });

  it('reads the time limit from TECTON_VALKEY_TIMEOUT_MS, and still from its former name (P9)', async () => {
    for (const variable of ['TECTON_VALKEY_TIMEOUT_MS', 'TECTON_REVOCATION_TIMEOUT_MS']) {
      const client = valkeyClientFromEnv({ TECTON_VALKEY_URL: 'redis://127.0.0.1:1', [variable]: '250' });
      expect(client.options.commandTimeout).toBe(250);
      await closeValkeyClient(client);
    }
  });

  it('prefers TECTON_VALKEY_TIMEOUT_MS and names the variable that is wrong (P9)', async () => {
    const client = valkeyClientFromEnv({ TECTON_VALKEY_URL: 'redis://127.0.0.1:1', TECTON_VALKEY_TIMEOUT_MS: '300', TECTON_REVOCATION_TIMEOUT_MS: '900' });
    expect(client.options.commandTimeout).toBe(300);
    await closeValkeyClient(client);

    expect(() => valkeyClientFromEnv({ TECTON_VALKEY_URL: 'redis://127.0.0.1:1', TECTON_VALKEY_TIMEOUT_MS: '0x10' })).toThrow(
      /^TECTON_VALKEY_TIMEOUT_MS must be a decimal integer between 50 and 5000$/,
    );
    expect(() => valkeyClientFromEnv({ TECTON_VALKEY_URL: 'redis://127.0.0.1:1', TECTON_VALKEY_TIMEOUT_MS: '40' })).toThrow(ValkeyConfigError);
  });

  it('reports not ready after the wait when Valkey is unreachable (P1, P2)', async () => {
    const client = valkeyClientFromEnv({ TECTON_VALKEY_URL: 'redis://127.0.0.1:1' });
    try {
      const started = Date.now();
      expect(await waitForValkeyReady(client, 300)).toBe(false);
      expect(Date.now() - started).toBeLessThan(1_500);
    } finally {
      await closeValkeyClient(client);
    }
  });
});
