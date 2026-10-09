import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ManifestAction, TectonManifest } from '@tecton/manifest';
import { frameworkErrors } from './errors/tecton-error.js';

export interface ActionContext {
  domain: string;
  action: string;
  request: FastifyRequest;
}

/** Implementation of one action: receives the validated input, returns the output. */
export type ActionHandler = (input: Record<string, unknown>, context: ActionContext) => Promise<unknown> | unknown;

export type ActionHandlers = Partial<Record<string, ActionHandler>>;

/** camelCase -> kebab-case; capital runs count as one word (`exportCSVReport` -> `export-csv-report`). */
function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

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
    response: { 200: action.outputSchema },
  };
}

/**
 * Registers one POST route per manifest action. Bodies are validated against the compiled
 * `input` before the handler runs; actions without a handler answer 501.
 */
export function registerActionRoutes(app: FastifyInstance, manifest: TectonManifest, handlers: ActionHandlers = {}): void {
  for (const action of manifest.actions) {
    const handler = handlers[action.name];
    app.post(actionRoutePath(manifest.domain, action.name), { schema: routeSchema(manifest.domain, action) }, async (request) => {
      if (!handler) throw frameworkErrors.notImplemented(manifest.domain, action.name);
      return handler(request.body as Record<string, unknown>, { domain: manifest.domain, action: action.name, request });
    });
  }
}
