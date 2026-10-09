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
// root and the test fixtures under tools/check-deps/fixtures.

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
      name: 'no-circular',
      comment: 'AD-3: the @tecton/* dependency graph must stay acyclic',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'Import cannot be resolved (typo, or a dependency that is not installed)',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|dist)/' },
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.ts', '.js', '.json'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
