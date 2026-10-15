import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { parseManifest, type TectonManifest } from '@tecton/manifest';
import { registerActionRoutes, type ActionHandlers } from './routes.js';
import { createTectonServer, type TectonServerOptions } from './server.js';

export interface DomainServerOptions extends TectonServerOptions {
  /** Path to the domain's tecton.yaml. */
  manifestPath: string;
  /** Port to listen on (0 picks a free port). Default 3000. */
  port?: number;
  /**
   * Interface to bind. Default 127.0.0.1 (loopback only): until token verification arrives
   * (Story 2.4), actions with `auth.requires` run without a token, so the service must not be
   * reachable from the network by default. Set `0.0.0.0` explicitly to expose it.
   */
  host?: string;
  /** Implemented actions; the others answer 501. */
  handlers?: ActionHandlers;
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
export async function startDomainServer(options: DomainServerOptions): Promise<FastifyInstance> {
  const manifest = loadDomainManifest(options.manifestPath);
  const app = createTectonServer(options.logger === undefined ? {} : { logger: options.logger });
  registerActionRoutes(app, manifest, options.handlers ?? {});
  await app.listen({ port: options.port ?? 3000, host: options.host ?? '127.0.0.1' });
  return app;
}
