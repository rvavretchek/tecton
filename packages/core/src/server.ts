import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { installErrorSerializer } from './errors/serializer.js';

export interface TectonServerOptions {
  logger?: FastifyServerOptions['logger'];
}

// Request validation must reject, not repair: Fastify's defaults strip unknown fields
// (removeAdditional) and coerce types (coerceTypes), which would hide contract violations.
// The ajv-compiler typings mark these keys as `never`, although they are honored at runtime
// (covered by the "unknown field" and "wrong type" tests in routes.test.ts).
const REQUEST_VALIDATION = { removeAdditional: false, coerceTypes: false, allErrors: true } as Record<string, unknown>;

/** Creates the Fastify instance every Tecton service runs on, with the single error serializer. */
export function createTectonServer(options: TectonServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, ajv: { customOptions: REQUEST_VALIDATION } });
  installErrorSerializer(app);
  return app;
}
