import type { FastifyError, FastifyInstance } from 'fastify';
import { frameworkErrors, TectonError, type InvalidParam } from './tecton-error.js';

/**
 * PROVISIONAL error body, until RFC 9457 (Epic 5, Story 5.2) replaces this function only.
 * Nothing else in the framework builds an error response body.
 */
export function toErrorBody(error: TectonError): Record<string, unknown> {
  return {
    status: error.status,
    slug: error.slug,
    i18nKey: error.i18nKey,
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
  };
}

function isValidationError(error: unknown): error is FastifyError & { validation: Array<{ instancePath: string; message?: string; params?: Record<string, unknown> }> } {
  return typeof error === 'object' && error !== null && Array.isArray((error as { validation?: unknown }).validation);
}

/** Maps any thrown value to a TectonError; unknown errors become a 500 without detail. */
export function toTectonError(error: unknown): TectonError {
  if (error instanceof TectonError) return error;
  if (isValidationError(error)) {
    const details: InvalidParam[] = error.validation.map((issue) => {
      const missing = issue.params?.['missingProperty'];
      const extra = issue.params?.['additionalProperty'];
      const field = typeof missing === 'string' ? `/${missing}` : typeof extra === 'string' ? `/${extra}` : '';
      return { name: `${issue.instancePath}${field}` || '/', reason: issue.message ?? 'is invalid' };
    });
    return frameworkErrors.validationFailed(details);
  }
  return frameworkErrors.internal();
}

/** Installs the single error serializer (and the 404 handler) on a Fastify instance. */
export function installErrorSerializer(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const tectonError = toTectonError(error);
    if (tectonError.status >= 500) request.log.error({ err: error }, 'unhandled error');
    return reply.code(tectonError.status).type('application/json').send(toErrorBody(tectonError));
  });
  app.setNotFoundHandler((_request, reply) => {
    const error = frameworkErrors.notFound();
    return reply.code(error.status).type('application/json').send(toErrorBody(error));
  });
}
