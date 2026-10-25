// Enforces AD-3 (dependency direction between @tecton/* packages) from the Architecture Spine.
// Allowed edges:
//   manifest       -> (none)
//   providers      -> manifest
//   ui             -> manifest
//   core           -> manifest, providers
//   service-client -> manifest, providers
//   auth           -> manifest, providers, core
//   directory      -> manifest, providers, core, ui
//   cli            -> any
// Paths are relative to the working directory, so the same config checks the repository
// root and the test fixtures under tools/check-deps/fixtures. Run it through
// tools/check-deps/check-deps.mjs (pnpm check:deps), which also reports the import
// specifier and undeclared workspace dependencies.

/** Builds a rule that forbids `pkg` from importing any @tecton package outside `allowed`. */
function allowOnly(pkg, allowed) {
  const permitted = [pkg, ...allowed].map((name) => `${name}/`).join('|');
  const comment =
    allowed.length > 0
      ? `AD-3: @tecton/${pkg} may only depend on ${allowed.map((name) => `@tecton/${name}`).join(', ')}`
      : `AD-3: @tecton/${pkg} must not depend on any other @tecton package`;
  return {
    name: allowed.length > 0 ? `ad-3-${pkg}-allowed-deps` : `ad-3-${pkg}-no-internal-deps`,
    comment,
    severity: 'error',
    from: { path: `^packages/${pkg}/` },
    to: { path: `^packages/(?!${permitted})[^/]+/` },
  };
}

// HTTP frameworks, servers and clients a port must never import (AD-1, FR-11). Fastify's own
// building blocks are listed too: a port could reach a request through them.
const HTTP_PACKAGE_NAMES = ['fastify', 'fastify-plugin', '@fastify/[^/]+', 'light-my-request', 'find-my-way', 'undici', 'express', 'koa', 'hono'];
const HTTP_PACKAGES = HTTP_PACKAGE_NAMES.join('|');
const HTTP_PACKAGES_TEXT = HTTP_PACKAGE_NAMES.map((name) => name.replace('[^/]+', '*')).join(', ');

const KNOWN_PACKAGES = ['manifest', 'providers', 'ui', 'core', 'service-client', 'auth', 'directory', 'cli'];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    allowOnly('manifest', []),
    allowOnly('providers', ['manifest']),
    allowOnly('ui', ['manifest']),
    allowOnly('core', ['manifest', 'providers']),
    allowOnly('service-client', ['manifest', 'providers']),
    allowOnly('auth', ['manifest', 'providers', 'core']),
    allowOnly('directory', ['manifest', 'providers', 'core', 'ui']),
    {
      // A new package must get its own allowOnly() line before it may import other packages.
      name: 'ad-3-unknown-package',
      comment: 'AD-3: this package has no dependency rule yet; add one to .dependency-cruiser.cjs',
      severity: 'error',
      from: { path: `^packages/(?!(?:${KNOWN_PACKAGES.join('|')})/)([^/]+)/` },
      to: { path: '^packages/', pathNot: '^packages/$1/' },
    },
    {
      // AD-1 and FR-11: ports never see an HTTP request. A KeyCustodyProvider tied to a route
      // would be bypassed by another service, a maintenance script or direct database access.
      name: 'providers-no-http-framework',
      comment: `AD-1: @tecton/providers must not import an HTTP framework, server or client (${HTTP_PACKAGES_TEXT}, node:http, node:https, node:http2)`,
      severity: 'error',
      from: { path: '^packages/providers/' },
      // Resolved into node_modules (a declared dependency) or left unresolved (a bare name).
      to: { path: `^(node:)?(http|https|http2)$|(^|/)node_modules/(${HTTP_PACKAGES})/|^(${HTTP_PACKAGES})(/|$)` },
    },
    {
      name: 'no-test-support-in-production',
      comment: 'Shared test support (#test-support) may only be imported from *.test.ts files',
      severity: 'error',
      from: { path: '^packages/[^/]+/src/', pathNot: '[.]test[.]ts$' },
      to: { path: '^tests/support/' },
    },
    {
      name: 'no-circular',
      comment: 'AD-3: the @tecton/* dependency graph must stay acyclic',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      // Only Tecton's own imports (relative, @tecton/*, #test-support): third-party imports are
      // already guaranteed by `pnpm typecheck`. dependency-cruiser 18.5 cannot resolve some valid
      // packages on Linux (e.g. uuid 14, whose "exports" nest conditions under "node") although
      // Node, TypeScript and enhanced-resolve itself all resolve them.
      name: 'not-to-unresolvable',
      comment: 'Import cannot be resolved (typo, or a dependency that is not installed)',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true, path: '^([.]|@tecton/|#)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Generated Prisma clients (packages/*/src/generated) have internal import cycles of their own;
    // they are not Tecton code and import nothing from @tecton/*.
    // node_modules stays in the graph as leaves (doNotFollow): excluding it would drop every
    // import of an npm package, and the rule against HTTP packages in providers would never see one.
    exclude: { path: '(^|/)dist/|^packages/[^/]+/src/generated/' },
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.ts', '.js', '.json'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
