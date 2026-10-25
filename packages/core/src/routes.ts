import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { toKebabCase, type ManifestAction, type TectonManifest } from '@tecton/manifest';
import type { KeyCustodyProvider } from '@tecton/providers';
import { InvalidTokenError, isUserSubject, MAX_TOKEN_LENGTH, serviceDomainOf, TokenVerificationUnavailableError, type Principal, type TokenVerifier } from './auth/token-verifier.js';
import { ERROR_BODY_SCHEMA } from './errors/serializer.js';
import { frameworkErrors } from './errors/tecton-error.js';

export interface ActionContext {
  domain: string;
  action: string;
  request: FastifyRequest;
  /** For response headers an action needs, such as a cookie (Story 2.3). The body is the returned output. */
  reply: FastifyReply;
  /**
   * Whose permissions were checked against `auth.requires`, from a token this service verified
   * itself (Story 2.4): the user a service acts on behalf of, or the calling service when there
   * is no user (Story 2.7b). Check `principal.kind` when the action needs a user. Present on every
   * action that is not public; never taken from a header such as x-user-id (AD-7).
   */
  principal?: Principal;
  /** The calling service, whenever the call came with a service token (Story 2.7b). */
  service?: Principal;
}

/** Implementation of one action: receives the validated input, returns the output. */
export type ActionHandler = (input: Record<string, unknown>, context: ActionContext) => Promise<unknown> | unknown;

export type ActionHandlers = Partial<Record<string, ActionHandler>>;

export interface ActionRoutesOptions {
  /** Verifies the token of every action that is not public. Required when the manifest has one. */
  verifier?: TokenVerifier;
  /**
   * Accept a user token alone in `Authorization` (Story 2.7b, AD-7 amendment of 2026-10-24). Off by
   * default: every call to a domain carries a service token, with the user, if any, in
   * `Tecton-On-Behalf-Of`. Only development (TECTON_ENV=development, through startDomainServer)
   * and the Auth service, which receives user tokens directly, turn it on.
   */
  directUserCalls?: boolean;
  /**
   * The Custodian of `sensitive.quorum` actions (FR-11). Not supported yet: no layer of the
   * framework asks it for a decision at the level of data access, so a provider given here stops
   * the registration instead of pretending to protect anything (Story 2.8). Without one, every
   * execution of a `sensitive.quorum` action is logged as unprotected.
   */
  keyCustody?: KeyCustodyProvider;
}

/** Why a configured KeyCustodyProvider is refused (Story 2.8). */
export const KEY_CUSTODY_NOT_SUPPORTED =
  'KeyCustodyProvider is not supported yet: sensitive.quorum is not enforced at the data level (FR-11); remove keyCustody';

/** Whether an action needs Custodian approval (`sensitive.quorum: true`). */
const needsQuorum = (action: ManifestAction) => action.sensitive?.quorum === true;

/** Header with the token of the user a service acts on behalf of: the raw JWT, without `Bearer`. */
export const ON_BEHALF_OF_HEADER = 'tecton-on-behalf-of';
const RAW_TOKEN = /^[A-Za-z0-9_.-]+$/;

/** The permission a service token needs to call the actions of `domain` (Story 2.7a, AD-7). */
export const callPermissionFor = (domain: string) => `call:${domain}`;

/** The kind of a principal, checked again here so a verifier written by hand cannot blur the two. */
const kindOfPrincipal = (principal: Principal) =>
  principal.kind === 'user' && isUserSubject(principal.subject)
    ? 'user'
    : principal.kind === 'service' && serviceDomainOf(principal.subject) !== undefined
      ? 'service'
      : undefined;

/**
 * The user of an action that needs one (Story 2.7b): a service calling without a user is refused
 * with 403. Use it in a handler whose action must act for a person (an owner, an audit field).
 */
export function requireUser(context: ActionContext): Principal {
  const principal = context.principal;
  if (!principal || kindOfPrincipal(principal) !== 'user') throw frameworkErrors.forbidden();
  return principal;
}

/** A fresh copy for each handler, dates included. */
const copyOf = (principal: Principal): Principal => ({
  ...principal,
  permissions: [...principal.permissions],
  issuedAt: new Date(principal.issuedAt),
  expiresAt: new Date(principal.expiresAt),
});

/** Route of an action: uniform RPC convention `POST /<domain>/<action-in-kebab-case>`. */
export function actionRoutePath(domain: string, actionName: string): string {
  return `/${domain}/${toKebabCase(actionName)}`;
}

/** Whether an action runs without a token. The one definition used by routes and the domain server. */
export const isPublicAction = (action: ManifestAction): boolean => 'public' in action.auth && action.auth.public === true;
const isPublic = isPublicAction;

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
      429: { description: 'Too many attempts (see Retry-After)', ...ERROR_BODY_SCHEMA },
      ...(protectedAction ? { 403: { description: 'Missing a permission the action requires', ...ERROR_BODY_SCHEMA } } : {}),
      // Token verification, revocation or a security dependency (login lockout) unavailable.
      503: { description: 'A security dependency is temporarily unavailable (see Retry-After)', ...ERROR_BODY_SCHEMA },
      500: { description: 'Internal error', ...ERROR_BODY_SCHEMA },
      501: { description: 'Action not implemented yet', ...ERROR_BODY_SCHEMA },
    },
  };
}

/**
 * Registers one POST route per manifest action. Every action that is not public verifies the
 * Bearer token first, before the body is read or validated: 401 for a missing or bad token (or a
 * user token alone, unless `directUserCalls`), 503 when the keys are unavailable, 403 for a
 * service token without `call:<domain>` or without every permission of `auth.requires` (the
 * user's, when the service acts on behalf of one in Tecton-On-Behalf-Of). Bodies are then
 * validated against the compiled `input`; actions without a handler answer 501.
 * Throws when `handlers` has a key that matches no action (usually a typo), and when an action is
 * protected but no verifier is given (never a protected route without verification).
 */
export function registerActionRoutes(app: FastifyInstance, manifest: TectonManifest, handlers: ActionHandlers = {}, options: ActionRoutesOptions = {}): void {
  // Before any route: a refused registration leaves none behind.
  if (options.keyCustody !== undefined) throw new Error(KEY_CUSTODY_NOT_SUPPORTED);
  const actionNames = new Set(manifest.actions.map((action) => action.name));
  const unknown = Object.keys(handlers).filter((name) => !actionNames.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `handlers for unknown actions of domain "${manifest.domain}": ${unknown.join(', ')} ` +
        `(declared actions: ${[...actionNames].join(', ') || 'none'})`,
    );
  }
  const { verifier } = options;
  const directUserCalls = options.directUserCalls === true;
  const ownCall = callPermissionFor(manifest.domain);
  const protectedActions = manifest.actions.filter((action) => !isPublic(action)).map((action) => action.name);
  // A protected action without permissions would let any valid token through (only possible with a
  // manifest built by hand: parseManifest refuses it).
  const unguarded = manifest.actions.filter((action) => !isPublic(action) && !('requires' in action.auth && action.auth.requires.length > 0));
  if (unguarded.length > 0) {
    throw new Error(`actions of domain "${manifest.domain}" must be public or require permissions: ${unguarded.map((action) => action.name).join(', ')}`);
  }
  if (protectedActions.length > 0 && !verifier) {
    throw new Error(
      `domain "${manifest.domain}" has actions that require a token (${protectedActions.join(', ')}) but no token verifier was given`,
    );
  }
  const callers = new WeakMap<FastifyRequest, { principal: Principal; service?: Principal }>();
  // FR-11: without a KeyCustodyProvider these actions run unprotected; the operator sees it at
  // startup, and again at every execution.
  const unprotected = manifest.actions.filter(needsQuorum).map((action) => action.name);
  if (unprotected.length > 0) {
    app.log.warn(
      { event: 'sensitive_quorum_unprotected_actions', domain: manifest.domain, actions: unprotected },
      'sensitive.quorum actions run without quorum protection: no KeyCustodyProvider is configured',
    );
  }

  // One token, as an Authorization value. Unavailability is 503; any refusal is the same 401.
  const verified = async (request: FastifyRequest, tokenVerifier: TokenVerifier, authorization: string | undefined): Promise<Principal> => {
    try {
      return await tokenVerifier.verify(authorization);
    } catch (error) {
      if (error instanceof TokenVerificationUnavailableError) {
        // The reason (refused redirect, CA, timeout...) for the operator; never the token or the URL.
        request.log.warn({ reason: error.message }, 'token verification unavailable');
        throw frameworkErrors.authUnavailable();
      }
      if (error instanceof InvalidTokenError) throw frameworkErrors.unauthorized();
      throw error;
    }
  };

  /**
   * Who is calling, in sequence (the first failure wins, so the answer is deterministic):
   * the Authorization token (401/503); a user token alone only with directUserCalls (401);
   * for a service, the user of Tecton-On-Behalf-Of when present (401/503); then call:<domain>
   * (403). Every check of a token comes before any 403.
   */
  const callerOf = async (request: FastifyRequest, tokenVerifier: TokenVerifier) => {
    const caller = await verified(request, tokenVerifier, request.headers.authorization);
    const kind = kindOfPrincipal(caller);
    if (kind === 'user') {
      if (!directUserCalls) throw frameworkErrors.unauthorized();
      // Identity comes only from the verified token: Tecton-On-Behalf-Of means nothing here (P0-013).
      return { principal: caller };
    }
    if (kind !== 'service') throw frameworkErrors.unauthorized();
    let principal = caller;
    // Absent means undefined only: an empty, repeated (joined with ", ") or prefixed value is refused.
    const onBehalfOf = request.headers[ON_BEHALF_OF_HEADER];
    if (onBehalfOf !== undefined) {
      if (typeof onBehalfOf !== 'string' || onBehalfOf.length > MAX_TOKEN_LENGTH || !RAW_TOKEN.test(onBehalfOf)) throw frameworkErrors.unauthorized();
      const user = await verified(request, tokenVerifier, `Bearer ${onBehalfOf}`);
      // A service never acts on behalf of another service.
      if (kindOfPrincipal(user) !== 'user') throw frameworkErrors.unauthorized();
      principal = user;
    }
    if (!caller.permissions.includes(ownCall)) {
      // For the operator: a dependencies entry is probably missing in the caller's manifest.
      request.log.warn({ event: 'service_call_refused', caller: caller.subject, domain: manifest.domain }, `service lacks ${ownCall}`);
      throw frameworkErrors.forbidden();
    }
    return { principal, service: caller };
  };

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
            const caller = await callerOf(request, verifier);
            // Every listed permission is required, from the user when a service acts on behalf of one.
            if (!requires.every((permission) => caller.principal.permissions.includes(permission))) throw frameworkErrors.forbidden();
            callers.set(request, caller);
          }
        : undefined;
    app.post(
      actionRoutePath(manifest.domain, action.name),
      { schema: routeSchema(manifest.domain, action), preValidation, ...(onRequest ? { onRequest } : {}) },
      async (request, reply) => {
        // First statement of the handler: after authentication and body validation (no warning on
        // 400, 401, 403 or 503), before the 501 and the handler (a warning even when it fails).
        // Fields from the manifest only: the input of a sensitive action may be the protected data.
        if (needsQuorum(action)) {
          request.log.warn(
            { event: 'sensitive_quorum_unprotected', domain: manifest.domain, action: action.name },
            `action "${action.name}" is sensitive.quorum but no KeyCustodyProvider is configured: running without quorum protection`,
          );
        }
        if (!handler) throw frameworkErrors.notImplemented(manifest.domain, action.name);
        const caller = callers.get(request);
        return handler(request.body as Record<string, unknown>, {
          domain: manifest.domain,
          action: action.name,
          request,
          reply,
          ...(caller ? { principal: copyOf(caller.principal) } : {}),
          ...(caller?.service ? { service: copyOf(caller.service) } : {}),
        });
      },
    );
  }
}
