// Public API of @tecton/core: service runtime (Fastify), action routes, errors, OpenAPI, and the
// local token verification of every service (Story 2.4).
export {
  createTokenVerifier,
  DEFAULT_AUDIENCE,
  DEFAULT_ISSUER,
  InvalidTokenError,
  isUserSubject,
  MAX_JWKS_BYTES,
  MAX_TOKEN_LENGTH,
  SERVICE_SUBJECT_PREFIX,
  serviceDomainOf,
  TokenVerificationUnavailableError,
  TokenVerifierConfigError,
  tokenVerifierFromEnv,
  type Principal,
  type PrincipalKind,
  type TokenVerifier,
  type TokenVerifierOptions,
} from './auth/token-verifier.js';
export { loadDomainManifest, startDomainServer, type DomainServerOptions } from './domain-server.js';
export { frameworkErrors, TectonError, type InvalidParam } from './errors/tecton-error.js';
export { buildOpenApiDocument } from './openapi.js';
export { actionRoutePath, callPermissionFor, isPublicAction, ON_BEHALF_OF_HEADER, registerActionRoutes, requireUser, type ActionContext, type ActionHandler, type ActionHandlers, type ActionRoutesOptions } from './routes.js';
export { createTectonServer, type TectonServerOptions } from './server.js';
