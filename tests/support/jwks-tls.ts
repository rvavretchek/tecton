import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// jwksTls fixture (ASR-4): a JWKS served over HTTPS by a certificate from a throwaway CA, trusted
// only by the verifier under test (passed as `ca`). Never NODE_TLS_REJECT_UNAUTHORIZED nor
// NODE_EXTRA_CA_CERTS. The certificates are made with the openssl binary (no dependency).

/** How the server answers the next JWKS requests. */
export type JwksMode = 'ok' | 'redirect' | 'error' | 'invalid-json' | 'html' | 'slow' | 'huge';

export interface JwksTlsServer {
  /** https://127.0.0.1:<port>/auth/.well-known/jwks.json */
  url: string;
  /** PEM of the throwaway CA. */
  ca: string;
  /** Replaces the published keys. */
  setKeys(keys: unknown[]): void;
  setMode(mode: JwksMode): void;
  /** Number of JWKS requests received so far. */
  requests(): number;
  stop(): Promise<void>;
}

function openssl(args: string[], cwd: string): void {
  // OPENSSL_CONF: a minimal config of our own, never whatever the machine points to (a broken
  // global one makes "req" fail). MSYS2_ARG_CONV_EXCL: an MSYS openssl would turn "/CN=..." into a path.
  const env = { ...process.env, OPENSSL_CONF: join(cwd, 'openssl.cnf'), MSYS2_ARG_CONV_EXCL: '*' };
  const result = spawnSync('openssl', args, { cwd, encoding: 'utf8', env });
  if (result.error || result.status !== 0) {
    throw new Error(
      `jwksTls needs the openssl binary on the PATH (openssl ${args[0]} failed: ${result.error?.message ?? result.stderr.trim()})`,
    );
  }
}

/** Throwaway CA and a server certificate for 127.0.0.1 and localhost, valid for one day. */
export function createTestCertificates(): { ca: string; key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tecton-jwks-tls-'));
  try {
    writeFileSync(join(dir, 'openssl.cnf'), ['[req]', 'distinguished_name = dn', '[dn]', ''].join('\n'));
    const ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'];
    openssl(['req', '-x509', ...ec, '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '1', '-subj', '/CN=tecton-test-ca', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], dir);
    openssl(['req', ...ec, '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost'], dir);
    writeFileSync(join(dir, 'server.ext'), ['subjectAltName=IP:127.0.0.1,DNS:localhost', 'basicConstraints=CA:FALSE', 'keyUsage=critical,digitalSignature', 'extendedKeyUsage=serverAuth', ''].join('\n'));
    openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.crt', '-days', '1', '-extfile', 'server.ext'], dir);
    const read = (name: string) => readFileSync(join(dir, name), 'utf8');
    return { ca: read('ca.crt'), key: read('server.key'), cert: read('server.crt') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const JWKS_TEST_PATH = '/auth/.well-known/jwks.json';

/** Starts the HTTPS JWKS server. `slowMs` is the delay of the "slow" mode. */
export async function jwksTls(options: { keys?: unknown[]; slowMs?: number } = {}): Promise<JwksTlsServer> {
  const { ca, key, cert } = createTestCertificates();
  let keys = options.keys ?? [];
  let mode: JwksMode = 'ok';
  let count = 0;
  const server = createServer({ key, cert }, (request, response) => {
    if (request.url !== JWKS_TEST_PATH) {
      response.writeHead(404).end();
      return;
    }
    count += 1;
    const json = (body: string) => response.writeHead(200, { 'content-type': 'application/json' }).end(body);
    switch (mode) {
      case 'redirect':
        response.writeHead(302, { location: 'https://attacker.example/auth/.well-known/jwks.json' }).end();
        return;
      case 'error':
        response.writeHead(500).end();
        return;
      case 'invalid-json':
        json('{"keys": [');
        return;
      case 'html':
        response.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>');
        return;
      case 'huge':
        json(JSON.stringify({ keys, padding: 'x'.repeat(100 * 1024) }));
        return;
      case 'slow':
        setTimeout(() => json(JSON.stringify({ keys })), options.slowMs ?? 2_000).unref();
        return;
      default:
        json(JSON.stringify({ keys }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `https://127.0.0.1:${port}${JWKS_TEST_PATH}`,
    ca,
    setKeys: (next) => void (keys = next),
    setMode: (next) => void (mode = next),
    requests: () => count,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
