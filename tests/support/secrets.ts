/**
 * Secret-leak detection for captured logs, spans and error bodies (Test Design P0-003).
 *
 * Passwords, the Pepper, password hashes, private keys, tokens and cookies must never
 * appear in any log line, span attribute or response body. Tests capture the output they
 * produce and assert it against the secrets they used.
 */

/** Secrets shorter than this are ignored: they would match by accident in ordinary text. */
export const MIN_SECRET_LENGTH = 6;

export interface SecretLeak {
  label: string;
  index: number;
}

export function findLeakedSecrets(output: string, secrets: Record<string, string>): SecretLeak[] {
  const leaks: SecretLeak[] = [];
  for (const [label, secret] of Object.entries(secrets)) {
    if (secret.length < MIN_SECRET_LENGTH) continue;
    const index = output.indexOf(secret);
    if (index !== -1) leaks.push({ label, index });
  }
  return leaks;
}

/** Throws if any secret appears in the output. The error names the secret, never its value. */
export function assertNoSecretsLeaked(output: string, secrets: Record<string, string>): void {
  const leaks = findLeakedSecrets(output, secrets);
  if (leaks.length > 0) {
    const names = leaks.map((leak) => `${leak.label} (at offset ${leak.index})`).join(', ');
    throw new Error(`Secret leaked into captured output: ${names}`);
  }
}
