/** One invalid field of a request; the base of RFC 9457 `invalid-params` (Story 5.3). */
export interface InvalidParam {
  /** JSON Pointer to the field, e.g. `/slug`. */
  name: string;
  reason: string;
}

/**
 * The single error abstraction of Tecton. Every error the framework produces is a TectonError;
 * `errors/serializer.ts` is the only place that turns it into an HTTP response.
 */
export class TectonError extends Error {
  /** HTTP status. */
  readonly status: number;
  /** Stable kebab-case identifier; becomes `urn:tecton:problem:<slug>` with RFC 9457 (Epic 5). */
  readonly slug: string;
  /** i18n catalog key, namespaced `<domain>.<key>` (AD-10); framework errors use `tecton.*`. */
  readonly i18nKey: string;
  readonly details?: InvalidParam[];

  constructor(options: { status: number; slug: string; i18nKey: string; message: string; details?: InvalidParam[] }) {
    super(options.message);
    this.name = 'TectonError';
    this.status = options.status;
    this.slug = options.slug;
    this.i18nKey = options.i18nKey;
    if (options.details) this.details = options.details;
  }
}

export const frameworkErrors = {
  validationFailed: (details: InvalidParam[]) =>
    new TectonError({
      status: 400,
      slug: 'validation-failed',
      i18nKey: 'tecton.error.validationFailed',
      message: 'request body does not match the action input',
      details,
    }),
  notFound: () =>
    new TectonError({ status: 404, slug: 'not-found', i18nKey: 'tecton.error.notFound', message: 'route not found' }),
  notImplemented: (domain: string, action: string) =>
    new TectonError({
      status: 501,
      slug: 'not-implemented',
      i18nKey: 'tecton.error.notImplemented',
      message: `action "${action}" of domain "${domain}" is not implemented yet`,
    }),
  /** Never carries the original exception: its message may leak internals. */
  internal: () => new TectonError({ status: 500, slug: 'internal-error', i18nKey: 'tecton.error.internal', message: 'internal error' }),
};
