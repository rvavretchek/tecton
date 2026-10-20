import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { toKebabCase, type ManifestAction, type TectonManifest } from '@tecton/manifest';
import { ERROR_BODY_SCHEMA } from './errors/serializer.js';
import { frameworkErrors } from './errors/tecton-error.js';

export interface ActionContext {
  domain: string;
  action: string;
  request: FastifyRequest;
  /** For response headers an action needs, such as a cookie (Story 2.3). The body is the returned output. */
  reply: FastifyReply;
}

/** Implementation of one action: receives the validated input, returns the output. */
export type ActionHandler = (input: Record<string, unknown>, context: ActionContext) => Promise<unknown> | unknown;

export type ActionHandlers = Partial<Record<string, ActionHandler>>;

/** Route of an action: uniform RPC convention `POST /<domain>/<action-in-kebab-case>`. */
export function actionRoutePath(domain: string, actionName: string): string {
  return `/${domain}/${toKebabCase(actionName)}`;
}

function routeSchema(domain: string, action: ManifestAction) {
  return {
    operationId: action.name,
    description: action.description,
    tags: [domain],
    body: action.inputSchema,
    // Serializing through the output schema drops fields the contract does not declare.
    // Error responses share the single error body (errors/serializer.ts).
    response: {
      200: action.outputSchema,
      400: { description: 'Invalid or unreadable request body', ...ERROR_BODY_SCHEMA },
      401: { description: 'Missing or invalid credentials', ...ERROR_BODY_SCHEMA },
      500: { description: 'Internal error', ...ERROR_BODY_SCHEMA },
      501: { description: 'Action not implemented yet', ...ERROR_BODY_SCHEMA },
    },
  };
}

/**
 * Registers one POST route per manifest action. Bodies are validated against the compiled
 * `input` before the handler runs; actions without a handler answer 501.
 * Throws when `handlers` has a key that matches no action (usually a typo).
 */
export function registerActionRoutes(app: FastifyInstance, manifest: TectonManifest, handlers: ActionHandlers = {}): void {
  const actionNames = new Set(manifest.actions.map((action) => action.name));
  const unknown = Object.keys(handlers).filter((name) => !actionNames.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `handlers for unknown actions of domain "${manifest.domain}": ${unknown.join(', ')} ` +
        `(declared actions: ${[...actionNames].join(', ') || 'none'})`,
    );
  }
  for (const action of manifest.actions) {
    // Own properties only: an action named "constructor" must not pick up Object.prototype.constructor.
    const handler = Object.hasOwn(handlers, action.name) ? handlers[action.name] : undefined;
    // An action without input fields also accepts a request with no body at all (a bare
    // `fetch(url, { method: 'POST' })`), validated as {}. A body with fields is still a 400.
    const takesNoInput = Object.keys(action.inputSchema.properties).length === 0;
    const preValidation = async (request: FastifyRequest) => {
      if (takesNoInput && request.body === undefined) request.body = {};
    };
    app.post(actionRoutePath(manifest.domain, action.name), { schema: routeSchema(manifest.domain, action), preValidation }, async (request, reply) => {
      if (!handler) throw frameworkErrors.notImplemented(manifest.domain, action.name);
      return handler(request.body as Record<string, unknown>, { domain: manifest.domain, action: action.name, request, reply });
    });
  }
}
