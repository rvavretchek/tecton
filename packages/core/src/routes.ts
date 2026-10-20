import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { toKebabCase, type ManifestAction, type TectonManifest } from '@tecton/manifest';
import { InvalidTokenError, TokenVerificationUnavailableError, type Principal, type TokenVerifier } from './auth/token-verifier.js';
import { ERROR_BODY_SCHEMA } from './errors/serializer.js';
import { frameworkErrors } from './errors/tecton-error.js';

export interface ActionContext {
  domain: string;
  action: string;
  request: FastifyRequest;
  /** For response headers an action needs, such as a cookie (Story 2.3). The body is the returned output. */
  reply: FastifyReply;
  /**
   * Who is calling, from the token this service verified itself (Story 2.4). Present on every
   * action that is not public; never taken from a header such as x-user-id (AD-7).
   */
  principal?: Principal;
}

/** Implementation of one action: receives the validated input, returns the output. */
export type ActionHandler = (input: Record<string, unknown>, context: ActionContext) => Promise<unknown> | unknown;

export type ActionHandlers = Partial<Record<string, ActionHandler>>;

export interface ActionRoutesOptions {
  /** Verifies the token of every action that is not public. Required when the manifest has one. */
  verifier?: TokenVerifier;
}

/** Route of an action: uniform RPC convention `POST /<domain>/<action-in-kebab-case>`. */
export function actionRoutePath(domain: string, actionName: string): string {
  return `/${domain}/${toKebabCase(actionName)}`;
}

const isPublic = (action: ManifestAction) => 'public' in action.auth && action.auth.public === true;

function routeSchema(domain: string, action: ManifestAction) {
  const protectedAction = !isPublic(action);
  return {
    operationId: action.name,
    description: action.description,
    tags: [domain],
    body: action.inputSchema,
    ...(protectedAction ? { security: [{ bearerAuth: [] }] } : {}),
    // Serializing through the output schema drops fields the contract does not declare.
    // Error responses share the single error body (errors/serializer.ts).
    response: {
      200: action.outputSchema,
      400: { description: 'Invalid or unreadable request body', ...ERROR_BODY_SCHEMA },
      401: { description: 'Missing or invalid credentials', ...ERROR_BODY_SCHEMA },
      ...(protectedAction
        ? {
            403: { description: 'Missing a permission the action requires', ...ERROR_BODY_SCHEMA },
            503: { description: 'Token verification temporarily unavailable', ...ERROR_BODY_SCHEMA },
          }
        : {}),
      500: { description: 'Internal error', ...ERROR_BODY_SCHEMA },
      501: { description: 'Action not implemented yet', ...ERROR_BODY_SCHEMA },
    },
  };
}

/**
 * Registers one POST route per manifest action. Every action that is not public verifies the
 * Bearer token first, before the body is read or validated: 401 for a missing or bad token, 503
 * when the keys are unavailable, 403 without every permission of `auth.requires`. Bodies are then
 * validated against the compiled `input`; actions without a handler answer 501.
 * Throws when `handlers` has a key that matches no action (usually a typo), and when an action is
 * protected but no verifier is given (never a protected route without verification).
 */
export function registerActionRoutes(app: FastifyInstance, manifest: TectonManifest, handlers: ActionHandlers = {}, options: ActionRoutesOptions = {}): void {
  const actionNames = new Set(manifest.actions.map((action) => action.name));
  const unknown = Object.keys(handlers).filter((name) => !actionNames.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `handlers for unknown actions of domain "${manifest.domain}": ${unknown.join(', ')} ` +
        `(declared actions: ${[...actionNames].join(', ') || 'none'})`,
    );
  }
  const { verifier } = options;
  const protectedActions = manifest.actions.filter((action) => !isPublic(action)).map((action) => action.name);
  if (protectedActions.length > 0 && !verifier) {
    throw new Error(
      `domain "${manifest.domain}" has actions that require a token (${protectedActions.join(', ')}) but no token verifier was given`,
    );
  }
  const principals = new WeakMap<FastifyRequest, Principal>();

  for (const action of manifest.actions) {
    // Own properties only: an action named "constructor" must not pick up Object.prototype.constructor.
    const handler = Object.hasOwn(handlers, action.name) ? handlers[action.name] : undefined;
    // An action without input fields also accepts a request with no body at all (a bare
    // `fetch(url, { method: 'POST' })`), validated as {}. A body with fields is still a 400.
    const takesNoInput = Object.keys(action.inputSchema.properties).length === 0;
    const preValidation = async (request: FastifyRequest) => {
      if (takesNoInput && request.body === undefined) request.body = {};
    };
    const requires = 'requires' in action.auth ? action.auth.requires : [];
    // onRequest runs before the body is parsed: an unauthenticated caller never learns the contract.
    const onRequest =
      verifier && !isPublic(action)
        ? async (request: FastifyRequest) => {
            let principal: Principal;
            try {
              principal = await verifier.verify(request.headers.authorization);
            } catch (error) {
              if (error instanceof TokenVerificationUnavailableError) throw frameworkErrors.authUnavailable();
              if (error instanceof InvalidTokenError) throw frameworkErrors.unauthorized();
              throw error;
            }
            // Every listed permission is required.
            if (!requires.every((permission) => principal.permissions.includes(permission))) throw frameworkErrors.forbidden();
            principals.set(request, principal);
          }
        : undefined;
    app.post(
      actionRoutePath(manifest.domain, action.name),
      { schema: routeSchema(manifest.domain, action), preValidation, ...(onRequest ? { onRequest } : {}) },
      async (request, reply) => {
        if (!handler) throw frameworkErrors.notImplemented(manifest.domain, action.name);
        const principal = principals.get(request);
        return handler(request.body as Record<string, unknown>, {
          domain: manifest.domain,
          action: action.name,
          request,
          reply,
          ...(principal ? { principal: { ...principal, permissions: [...principal.permissions] } } : {}),
        });
      },
    );
  }
}
