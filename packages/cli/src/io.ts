/** Where a command reads its context and writes its output; injectable for tests. */
export interface CliIo {
  cwd: string;
  stdout: { write(text: string): void };
  stderr: { write(text: string): void };
  /** Standard input, for commands that read secrets from it (never from arguments). */
  stdin?: { isTTY?: boolean; readAll(): Promise<string> };
  /** Environment variables; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
