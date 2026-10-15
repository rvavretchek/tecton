// Source hygiene (Epic 1 retrospective, action A2): editing code through scripts has written
// literal control characters into sources more than once (a real line break inside a string
// literal, a byte order mark written as the character itself). This scan fails the build on them.
//
// Characters are checked by code point, never written as escapes, so this file cannot be
// corrupted the same way.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Text files covered: code, configuration and workflows. */
export const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml'] as const;

const TAB = 9;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const DELETE = 0x7f;
const BYTE_ORDER_MARK = 0xfeff;

export interface HygieneIssue {
  file: string;
  line: number;
  column: number;
  /** Code point in hexadecimal, e.g. "U+FEFF". */
  codePoint: string;
  kind: 'byte-order-mark' | 'control-character';
}

function describe(code: number): HygieneIssue['kind'] | undefined {
  if (code === BYTE_ORDER_MARK) return 'byte-order-mark';
  if (code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN) return undefined;
  if (code < 32 || code === DELETE || (code >= 0x80 && code <= 0x9f)) return 'control-character';
  return undefined;
}

/** Every byte order mark (anywhere, including the first character) and control character but tab and line breaks. */
export function findHygieneIssues(file: string, text: string): HygieneIssue[] {
  const issues: HygieneIssue[] = [];
  let line = 1;
  let column = 1;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const kind = describe(code);
    if (kind) issues.push({ file, line, column, kind, codePoint: `U+${code.toString(16).toUpperCase().padStart(4, '0')}` });
    if (code === LINE_FEED) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return issues;
}

/** Files tracked by Git (plus untracked, not ignored) with a scanned extension. */
export function scannedFiles(root: string): string[] {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  return output
    .split(/\r?\n/)
    .filter((file) => file !== '' && SCANNED_EXTENSIONS.some((extension) => file.endsWith(extension)));
}

export function scanRepository(root: string): HygieneIssue[] {
  return scannedFiles(root).flatMap((file) => findHygieneIssues(file, readFileSync(join(root, file), 'utf8')));
}
