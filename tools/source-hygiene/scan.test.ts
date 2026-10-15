import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findHygieneIssues, scanRepository } from './scan.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const char = (code: number) => String.fromCodePoint(code);

describe('findHygieneIssues', () => {
  it('accepts tabs and both line break styles', () => {
    expect(findHygieneIssues('a.ts', `const a = 1;${char(9)}// x${char(13)}${char(10)}const b = 2;${char(10)}`)).toEqual([]);
  });

  it('reports a byte order mark written as a character, with its position', () => {
    const text = `const bom = /^${char(0xfeff)}/;${char(10)}`;

    expect(findHygieneIssues('a.ts', text)).toEqual([
      { file: 'a.ts', line: 1, column: 15, codePoint: 'U+FEFF', kind: 'byte-order-mark' },
    ]);
  });

  it('reports a byte order mark at the start of a file', () => {
    expect(findHygieneIssues('a.json', `${char(0xfeff)}{}`)).toMatchObject([{ line: 1, column: 1, kind: 'byte-order-mark' }]);
  });

  it.each([0, 7, 27, 0x7f, 0x85])('reports control character %i', (code) => {
    expect(findHygieneIssues('a.ts', `const key = "a${char(code)}b";`)).toMatchObject([{ line: 1, column: 15, kind: 'control-character' }]);
  });
});

describe('repository source hygiene (Epic 1 retrospective, A2)', () => {
  it('has no byte order mark or control character in code, configuration or workflows', () => {
    const issues = scanRepository(repoRoot).map((issue) => `${issue.file}:${issue.line}:${issue.column} ${issue.kind} ${issue.codePoint}`);

    expect(issues).toEqual([]);
  });
});
