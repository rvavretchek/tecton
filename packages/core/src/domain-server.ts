import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { parseManifest, type TectonManifest } from '@tecton/manifest';
import { tokenVerifierFromEnv, type TokenVerifier } from './auth/token-verifier.js';
import { isPublicAction, registerActionRoutes, type ActionHandlers } from './routes.js';
import { createTectonServer, type TectonServerOptions } from './server.js';

export interface DomainServerOptions extends TectonServerOptions {
  /** Path to the domain's tecton.yaml. */
  manifestPath: string;
  /** Port to listen on (0 picks a free port). Default 3000. */
  port?: number;
  /**
   * Interface to bind. Default 127.0.0.1 (loopback only): exposing a service is a decision, so
   * set `0.0.0.0` explicitly. Every protected action verifies its token either way (Story 2.4).
   */
  host?: string;
  /** Implemented actions; the others answer 501. */
  handlers?: ActionHandlers;
  /**
   * Verifies the tokens of the protected actions. When omitted and the manifest has a protected
   * action, it comes from the environment (tokenVerifierFromEnv: TECTON_JWKS_URL...), so a
   * missing configuration stops the service at startup.
   */
  verifier?: TokenVerifier;
  /** Environment read when `verifier` is omitted. Default process.env. */
  env?: NodeJS.ProcessEnv;
}

/** Reads and validates a domain manifest; throws with every problem when it is invalid. */
export function loadDomainManifest(manifestPath: string): TectonManifest {
  const result = parseManifest(readFileSync(manifestPath, 'utf8'));
  if (result.ok) return result.manifest;
  const problems = result.errors.map((error) => `  ${error.line === undefined ? '' : `line ${error.line}: `}${error.path || '(file)'} ${error.code}: ${error.message}`);
  throw new Error(`invalid manifest ${manifestPath}:\n${problems.join('\n')}`);
}

/**
 * Starts a domain service from its manifest: the walking skeleton of every generated domain.
 * Routes come from the manifest actions; actions without a handler answer 501.
 */
/** How long a domain service waits for its revocation store at startup before listening anyway. */
const VALKEY_READY_WAIT_MS = 2_000;

export async function startDomainServer(options: DomainServerOptions): Promise<FastifyInstance> {
  const manifest = loadDomainManifest(options.manifestPath);
  const needsVerifier = manifest.actions.some((action) => !isPublicAction(action));
  const app = createTectonServer(options.logger === undefined ? {} : { logger: options.logger });
  try {
    // A verifier built here (from the environment) belongs to this server: it closes with it.
    // Its revocation store reports connection problems in the service log, without the URL.
    const owned =
      options.verifier === undefined && needsVerifier
        ? tokenVerifierFromEnv(options.env ?? process.env, {
            onRevocationStoreError: (error) => app.log.warn({ reason: error.message }, 'revocation store connection error'),
          })
        : undefined;
    const verifier = options.verifier ?? owned;
    if (owned?.close) {
      const close = owned.close.bind(owned);
      app.addHook('onClose', async () => close());
    }
    registerActionRoutes(app, manifest, options.handlers ?? {}, verifier ? { verifier } : {});
    // Waits a little for Valkey before taking traffic; if it is down, the service starts anyway
    // and refuses protected actions with 503 until it is reachable (fail closed).
    if (owned?.ready && !(await owned.ready(VALKEY_READY_WAIT_MS))) {
      app.log.warn({ event: 'revocation_store_not_ready' }, 'revocation store not reachable at startup; protected actions answer 503 until it is');
    }
    await app.listen({ port: options.port ?? 3000, host: options.host ?? '127.0.0.1' });
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
  return app;
}
