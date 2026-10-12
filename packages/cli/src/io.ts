/** Where a command reads its context and writes its output; injectable for tests. */
export interface CliIo {
  cwd: string;
  stdout: { write(text: string): void };
  stderr: { write(text: string): void };
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
