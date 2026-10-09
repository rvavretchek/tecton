// Public API of @tecton/core: service runtime (Fastify), action routes, errors, OpenAPI.
export { frameworkErrors, TectonError, type InvalidParam } from './errors/tecton-error.js';
export { buildOpenApiDocument } from './openapi.js';
export { actionRoutePath, registerActionRoutes, type ActionContext, type ActionHandler, type ActionHandlers } from './routes.js';
export { createTectonServer } from './server.js';
