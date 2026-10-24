import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMAIN_NAME_PATTERN, parseManifest } from '@tecton/manifest';
import type { CliIo } from '../io.js';
import { findWorkspace } from '../workspace.js';
import { readSecret, SecretInputError } from './secret-input.js';

export const AUTH_URL_VARIABLE = 'TECTON_AUTH_URL';
export const ADMIN_PASSWORD_VARIABLE = 'TECTON_AUTH_ADMIN_PASSWORD';
/** Exit code when the service already has a credential (nothing changed), so scripts can tell it from a failure. */
export const EXIT_ALREADY_REGISTERED = 2;
/** How long each request to the Auth service may take. */
export const AUTH_REQUEST_TIMEOUT_MS = 10_000;

export interface AuthRegisterServiceOptions {
  login: string;
  permission?: string[];
  rotate?: boolean;
}

/** Replaceable for tests; production uses the global fetch. */
export interface AuthRegisterServiceDependencies {
  fetch: typeof fetch;
  /** How long to wait for a piped password before giving up. Default 10 s. */
  stdinTimeoutMs?: number;
}

const defaultDependencies: AuthRegisterServiceDependencies = { fetch: (input, init) => fetch(input, init) };

const DOMAIN_NAME = new RegExp(DOMAIN_NAME_PATTERN);

class CommandError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

/**
 * TECTON_AUTH_URL: the base URL of the Auth service. https is required outside
 * TECTON_ENV=development, as for the JWKS (Story 2.4); a URL with user or password is refused,
 * because the password would end up in shell history and error messages.
 */
function authUrlFromEnv(env: NodeJS.ProcessEnv): URL {
  const raw = env[AUTH_URL_VARIABLE];
  if (!raw) throw new CommandError(`${AUTH_URL_VARIABLE} is not set; point it to the Auth service (e.g. http://127.0.0.1:3001 in development)`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CommandError(`${AUTH_URL_VARIABLE} is not a valid URL`);
  }
  if (url.username !== '' || url.password !== '') throw new CommandError(`${AUTH_URL_VARIABLE} must not contain a user or password`);
  const development = env['TECTON_ENV'] === 'development';
  if (url.protocol !== 'https:' && !(development && url.protocol === 'http:')) {
    throw new CommandError(`${AUTH_URL_VARIABLE} must use https (http is accepted only with TECTON_ENV=development)`);
  }
  if (url.search !== '' || url.hash !== '') throw new CommandError(`${AUTH_URL_VARIABLE} must not contain a query or fragment`);
  // A path prefix is kept (an Auth service behind a Gateway under /tecton, for example).
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  return url;
}

/** A permission travels in a comma-separated list: no comma, no surrounding spaces, not empty. */
function assertPermissionArgument(permission: string): void {
  if (permission === '' || permission.trim() !== permission || permission.includes(',')) {
    throw new CommandError(`--permission ${JSON.stringify(permission)} is invalid: give one permission per --permission, without commas or surrounding spaces`);
  }
}

/** The refresh cookie the login set (name=value only), so the logout can end that session too. */
function refreshCookieOf(response: Response): string | undefined {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';', 1)[0]?.trim();
    if (pair?.startsWith('tecton_refresh=')) return pair;
  }
  return undefined;
}

/** The JSON body, or undefined when it is not JSON (a proxy error page, an empty body). */
const jsonOf = (response: Response): Promise<unknown> => response.json().catch(() => undefined);

/** The dependencies of the domain, from apps/domains/<domain>/tecton.yaml of the workspace. */
function dependenciesOf(cwd: string, domain: string): string[] {
  const workspace = findWorkspace(cwd);
  if (!workspace) throw new CommandError('not inside a Tecton workspace (created by tecton-admin new); run the command from it');
  const path = join(workspace.root, 'apps', 'domains', domain, 'tecton.yaml');
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    throw new CommandError(`cannot read the manifest of "${domain}" at ${path}; generate the domain first (tecton-admin generate domain ${domain})`);
  }
  const parsed = parseManifest(source);
  if (!parsed.ok) {
    const first = parsed.errors[0];
    throw new CommandError(`the manifest at ${path} is invalid${first ? `: ${first.message}` : ''}; run tecton-admin lint`);
  }
  if (parsed.manifest.domain !== domain) {
    throw new CommandError(`the manifest at ${path} declares domain "${parsed.manifest.domain}", not "${domain}"`);
  }
  return parsed.manifest.dependencies;
}

/** Reasons a problem body (RFC 9457) gives, without echoing anything else of the response. */
function reasonsOf(body: unknown): string {
  const details = (body as { details?: unknown } | null)?.details;
  if (!Array.isArray(details)) return '';
  const reasons = details.map((detail) => (detail as { reason?: unknown }).reason).filter((reason): reason is string => typeof reason === 'string');
  return reasons.length > 0 ? `: ${reasons.join('; ')}` : '';
}

/**
 * `tecton-admin auth register-service <domain> --login <admin>`: registers the service credential
 * of a domain in the Auth service (Story 2.7a), logging in as the administrator inside the command
 * (EQ-5): the password comes from TECTON_AUTH_ADMIN_PASSWORD or standard input, the access token
 * stays in memory and is revoked by a logout at the end, also on failure. The dependencies come
 * from the domain manifest; the permissions from --permission. The secret is printed once.
 * Exit codes: 0 registered (or rotated), 2 already registered (nothing changed), 1 any failure.
 */
export async function authRegisterServiceCommand(
  domain: string,
  options: AuthRegisterServiceOptions,
  io: CliIo,
  dependencies: AuthRegisterServiceDependencies = defaultDependencies,
): Promise<number> {
  const env = io.env ?? process.env;
  let accessToken: string | undefined;
  let refreshCookie: string | undefined;
  let accessTokenLifetime = 'until it expires';
  let base: URL | undefined;
  const call = (path: string, body: unknown, token?: string, cookie?: string) =>
    dependencies.fetch(new URL(path, base), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
    });
  // Network errors may carry the URL; only their kind is printed.
  const unreachable = (error: unknown): never => {
    const kind = error instanceof Error ? error.name : 'unexpected error';
    throw new CommandError(`could not reach the Auth service (${kind}); check ${AUTH_URL_VARIABLE} and that the service is running`);
  };

  try {
    if (!DOMAIN_NAME.test(domain)) throw new CommandError(`"${domain}" is not a valid domain name (kebab-case)`);
    const permissions = options.permission ?? [];
    for (const permission of permissions) assertPermissionArgument(permission);
    const callees = dependenciesOf(io.cwd, domain);
    base = authUrlFromEnv(env);
    const password = await readSecret(io, env, {
      variable: ADMIN_PASSWORD_VARIABLE,
      example: `printf '%s' "$PASSWORD" | tecton-admin auth register-service ${domain} --login admin`,
      timeoutMs: dependencies.stdinTimeoutMs ?? 10_000,
    });

    const login = await call('auth/login', { login: options.login, password }).catch(unreachable);
    if (login.status === 401) throw new CommandError('login refused: wrong login or password');
    if (login.status === 429) throw new CommandError(`login locked after too many failures; wait or run tecton-admin auth unlock ${options.login}`);
    if (login.status !== 200) throw new CommandError(`login failed with status ${login.status}`);
    refreshCookie = refreshCookieOf(login);
    const session = (await jsonOf(login)) as { accessToken?: unknown; expiresIn?: unknown } | undefined;
    if (typeof session?.accessToken !== 'string') throw new CommandError('login answered without an access token');
    accessToken = session.accessToken;
    if (typeof session.expiresIn === 'number') accessTokenLifetime = `for up to ${session.expiresIn} seconds`;

    const registration = await call(
      'auth/register-service',
      { domain, dependencies: callees.join(','), permissions: permissions.join(','), rotate: options.rotate === true },
      accessToken,
    ).catch((error: unknown): never => {
      // The request may have reached the service and been applied: its secret would be lost.
      const kind = error instanceof Error ? error.name : 'unexpected error';
      throw new CommandError(
        `no answer from the Auth service to the registration (${kind}); it may have been applied. ` +
          `Run the command again: if it says the service is already registered, add --rotate to get a usable secret`,
      );
    });
    if (registration.status === 409) {
      throw new CommandError(`service "${domain}" is already registered; nothing changed (use --rotate to replace its secret)`, EXIT_ALREADY_REGISTERED);
    }
    if (registration.status === 429) {
      throw new CommandError(`the credential of "${domain}" was rotated too recently; nothing changed, try again in ${registration.headers.get('retry-after') ?? 'a few'} seconds`);
    }
    if (registration.status === 403) throw new CommandError(`"${options.login}" lacks the permission auth:service:register`);
    if (registration.status === 400) throw new CommandError(`registration refused${reasonsOf(await jsonOf(registration))}`);
    if (registration.status !== 200) throw new CommandError(`registration failed with status ${registration.status}`);
    const result = (await jsonOf(registration)) as { secret?: unknown; rotated?: unknown } | undefined;
    if (typeof result?.secret !== 'string') throw new CommandError('registration answered without a secret; it may have been applied, run the command again with --rotate');

    const rotated = result.rotated === true;
    const lines = [
      `${rotated ? 'Rotated' : 'Registered'} the credential of service "${domain}" (service:${domain}).`,
      `Calls: ${callees.length > 0 ? callees.join(', ') : 'none'}. Permissions: ${permissions.length > 0 ? permissions.join(', ') : 'none'}.`,
      ...(rotated ? ['The previous secret no longer works, and the tokens issued with it are revoked.'] : []),
      'Secret (shown only this once; store it where the service reads its secrets):',
      result.secret,
    ];
    io.stdout.write(`${lines.join('\n')}\n`);
    return 0;
  } catch (error) {
    if (error instanceof CommandError) {
      io.stderr.write(`auth register-service ${error.exitCode === EXIT_ALREADY_REGISTERED ? 'refused' : 'failed'}: ${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof SecretInputError) {
      io.stderr.write(`auth register-service failed: ${error.message}\n`);
      return 1;
    }
    throw error;
  } finally {
    if (accessToken) {
      // The administrator token never outlives the command (EQ-5).
      // With the refresh cookie of the login: the session it opened ends too.
      const loggedOut = await call('auth/logout', {}, accessToken, refreshCookie).then(
        (response) => response.status === 200,
        () => false,
      );
      if (!loggedOut) io.stderr.write(`warning: could not log out; the administrator token stays valid ${accessTokenLifetime}\n`);
    }
  }
}
