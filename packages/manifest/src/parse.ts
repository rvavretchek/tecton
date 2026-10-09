import { Ajv } from 'ajv';
import { isMap, isNode, isPair, isScalar, LineCounter, parseDocument, type Document, type YAMLError } from 'yaml';
import { translateAjvErrors, type PathSegments } from './errors.js';
import { manifestJsonSchema } from './schema.js';
import type { ManifestError, ParseOptions, ParseResult, TectonManifest } from './types.js';

// Compiled once per process; `allErrors` so every problem comes back in one pass.
const validate = new Ajv({ strict: true, allErrors: true }).compile(manifestJsonSchema);

type Position = { line: number; column: number };

function positionAt(lineCounter: LineCounter, offset: number): Position {
  const { line, col } = lineCounter.linePos(offset);
  return { line, column: col };
}

function withPosition<T extends Omit<ManifestError, 'line' | 'column'>>(error: T, position?: Position): ManifestError {
  return position ? { ...error, line: position.line, column: position.column } : { ...error };
}

function syntaxError(error: YAMLError, lineCounter: LineCounter): ManifestError {
  return withPosition(
    { path: '', code: 'yaml-syntax', message: error.message.split('\n')[0] ?? error.message },
    positionAt(lineCounter, error.pos[0]),
  );
}

/** Finds the source position of a path: the key itself (`key: true`) or the value node. */
function locate(doc: Document, lineCounter: LineCounter, segments: PathSegments, key = false): Position | undefined {
  if (key && segments.length > 0) {
    const parent = segments.length === 1 ? doc.contents : doc.getIn(segments.slice(0, -1), true);
    const name = segments.at(-1);
    if (isMap(parent)) {
      const pair = parent.items.find((item) => isPair(item) && isScalar(item.key) && item.key.value === name);
      if (pair && isNode(pair.key) && pair.key.range) return positionAt(lineCounter, pair.key.range[0]);
    }
  }
  const node = segments.length === 0 ? doc.contents : doc.getIn(segments, true);
  if (isNode(node) && node.range) return positionAt(lineCounter, node.range[0]);
  return undefined;
}

function compareErrors(a: ManifestError, b: ManifestError): number {
  const lineA = a.line ?? Number.MAX_SAFE_INTEGER;
  const lineB = b.line ?? Number.MAX_SAFE_INTEGER;
  if (lineA !== lineB) return lineA - lineB;
  const columnA = a.column ?? Number.MAX_SAFE_INTEGER;
  const columnB = b.column ?? Number.MAX_SAFE_INTEGER;
  if (columnA !== columnB) return columnA - columnB;
  // Missing fields are located at their parent; list them before the parent's other errors.
  if ((a.code === 'required') !== (b.code === 'required')) return a.code === 'required' ? -1 : 1;
  return a.path.localeCompare(b.path);
}

/**
 * Parses and validates the identity of a `tecton.yaml`. Never throws for invalid input:
 * every problem is returned at once, with a stable code and, when known, line/column.
 */
export function parseManifest(source: string, _options: ParseOptions = {}): ParseResult {
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter, prettyErrors: false, uniqueKeys: true });

  const problems = [...doc.errors, ...doc.warnings];
  if (problems.length > 0) {
    return { ok: false, errors: problems.map((problem) => syntaxError(problem, lineCounter)).sort(compareErrors) };
  }

  if (!isMap(doc.contents)) {
    const position = isNode(doc.contents) && doc.contents.range ? positionAt(lineCounter, doc.contents.range[0]) : undefined;
    return {
      ok: false,
      errors: [
        withPosition(
          { path: '', code: 'invalid-root', message: 'the manifest must be a YAML mapping (key: value pairs) at the top level' },
          position,
        ),
      ],
    };
  }

  const data: unknown = doc.toJS();
  if (!validate(data)) {
    const errors = translateAjvErrors(validate.errors ?? [], data).map(({ error, locate: target }) =>
      withPosition(error, locate(doc, lineCounter, target.segments, target.key)),
    );
    return { ok: false, errors: errors.sort(compareErrors) };
  }

  const manifest = data as Omit<TectonManifest, 'dependencies'> & { dependencies?: string[] };
  return { ok: true, manifest: { ...manifest, dependencies: manifest.dependencies ?? [] } };
}
