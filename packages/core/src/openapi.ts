import swagger from '@fastify/swagger';
import type { TectonManifest } from '@tecton/manifest';
import { registerActionRoutes } from './routes.js';
import { createTectonServer } from './server.js';

/**
 * OpenAPI 3.1 document of a domain, generated from the routes its manifest produces (FR-5).
 * Always derived, never written by hand: regenerate after any manifest change.
 */
export async function buildOpenApiDocument(manifest: TectonManifest): Promise<Record<string, unknown>> {
  const app = createTectonServer({ logger: false });
  try {
    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: { title: manifest.domain, version: manifest.version, description: manifest.description },
      },
    });
    registerActionRoutes(app, manifest);
    await app.ready();
    return app.swagger() as unknown as Record<string, unknown>;
  } finally {
    await app.close();
  }
}
