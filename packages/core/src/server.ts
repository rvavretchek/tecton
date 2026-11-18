import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { installErrorSerializer } from './errors/serializer.js';

export interface TectonServerOptions {
  logger?: FastifyServerOptions['logger'];
  /**
   * Log unexpected errors by name and code only, never their message or stack, which may carry a
   * connection string or a query (the Auth service). Default false: domains log the full error.
   */
  safeErrorLogs?: boolean;
}

// Request validation must reject, not repair: Fastify's defaults strip unknown fields
// (removeAdditional) and coerce types (coerceTypes), which would hide contract violations.
// The ajv-compiler typings mark these keys as `never`, although they are honored at runtime
// (covered by the "unknown field" and "wrong type" tests in routes.test.ts).
const REQUEST_VALIDATION = { removeAdditional: false, coerceTypes: false, allErrors: true } as Record<string, unknown>;

/**
 * Request and response parts never logged by a Tecton service: both credentials of a call (the
 * token in Authorization and the user's in Tecton-On-Behalf-Of), cookies and set-cookie.
 */
export const LOG_REDACTION = ['req.headers.authorization', 'req.headers.cookie', 'req.headers["tecton-on-behalf-of"]', 'res.headers["set-cookie"]'];

/** Creates the Fastify instance every Tecton service runs on, with the single error serializer. */
export function createTectonServer(options: TectonServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, ajv: { customOptions: REQUEST_VALIDATION } });
  installErrorSerializer(app, { safeErrorLogs: options.safeErrorLogs === true });
  return app;
}
