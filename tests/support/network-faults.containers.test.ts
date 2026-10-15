import { createConnection } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreatedProxy } from '@testcontainers/toxiproxy';
import { startValkey, type StartedValkey } from './containers.js';
import { startFaultLab, withDependencyDown, type FaultLab } from './network-faults.js';

/**
 * Sends a raw RESP PING; resolves with the reply, rejects with the socket error, with
 * "closed" when the connection ends without a reply, or with "timeout".
 */
function ping(host: string, port: number, timeoutMs = 2_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('timeout'));
    }, timeoutMs);
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once('close', () => {
      clearTimeout(timer);
      reject(new Error('closed'));
    });
    socket.once('connect', () => socket.write('PING\r\n'));
    socket.once('data', (data) => {
      clearTimeout(timer);
      socket.end();
      resolve(data.toString().trim());
    });
  });
}

describe('withDependencyDown (Valkey behind Toxiproxy)', () => {
  let lab: FaultLab;
  let valkey: StartedValkey;
  let proxy: CreatedProxy;

  beforeAll(async () => {
    lab = await startFaultLab();
    valkey = await startValkey(lab.network);
    proxy = await lab.proxy('valkey', `${valkey.networkAlias}:6379`);
  }, 180_000);

  afterAll(async () => {
    await valkey?.stop();
    await lab?.stop();
  });

  it('reaches Valkey through the proxy while it is up', async () => {
    expect(await ping(proxy.host, proxy.port)).toBe('+PONG');
  });

  it('makes Valkey unreachable inside the callback and restores it afterwards', async () => {
    await withDependencyDown(proxy, async () => {
      // No PONG while disabled. How the cut shows depends on the Docker networking in between:
      // a close/refusal on a local engine, a silent drop (timeout) through a remote one.
      await expect(ping(proxy.host, proxy.port)).rejects.toThrow(/closed|timeout|ECONNREFUSED|ECONNRESET/);
    });

    expect(await ping(proxy.host, proxy.port)).toBe('+PONG');
  });
});
