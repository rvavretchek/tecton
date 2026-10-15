/**
 * camelCase/PascalCase -> kebab-case; runs of capitals count as one word
 * (`exportCSVReport` -> `export-csv-report`, `ExportCSVReady` -> `export-csv-ready`).
 *
 * Single definition for everything derived from a name: action routes (@tecton/core) and
 * CloudEvents types. Two names with the same kebab-case form would collide there, so the
 * parser rejects them (actions.ts, events.ts).
 */
export function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}
