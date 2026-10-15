/**
 * Secret-leak detection for captured logs, spans and error bodies (Test Design P0-003).
 *
 * Passwords, the Pepper, password hashes, private keys, tokens and cookies must never
 * appear in any log line, span attribute or response body. Tests capture the output they
 * produce and assert it against the secrets they used.
 *
 * Besides the literal value, the common encodings a leak goes through are checked: JSON
 * string escaping, URL encoding (query strings, form bodies) and base64/base64url (Basic
 * auth, JWT segments, cookies).
 */

/**
 * Secrets shorter than this would match by accident in ordinary text. Passing one is a
 * test bug, so it throws instead of being skipped: use a longer synthetic secret.
 */
export const MIN_SECRET_LENGTH = 6;

export interface SecretLeak {
  label: string;
  index: number;
  /** Which form of the secret was found. */
  encoding: 'literal' | 'json' | 'url' | 'base64' | 'base64url';
}

function encodedForms(secret: string): Array<[SecretLeak['encoding'], string]> {
  const base64 = Buffer.from(secret, 'utf8').toString('base64');
  const forms: Array<[SecretLeak['encoding'], string]> = [
    ['literal', secret],
    ['json', JSON.stringify(secret).slice(1, -1)],
    ['url', encodeURIComponent(secret)],
    // Without padding: the secret may sit in the middle of a longer encoded value.
    ['base64', base64.replace(/=+$/, '')],
    ['base64url', Buffer.from(secret, 'utf8').toString('base64url')],
  ];
  const seen = new Set<string>();
  return forms.filter(([, form]) => !seen.has(form) && seen.add(form));
}

export function findLeakedSecrets(output: string, secrets: Record<string, string>): SecretLeak[] {
  const leaks: SecretLeak[] = [];
  for (const [label, secret] of Object.entries(secrets)) {
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new RangeError(
        `Secret "${label}" is shorter than ${MIN_SECRET_LENGTH} characters and cannot be checked reliably`,
      );
    }
    for (const [encoding, form] of encodedForms(secret)) {
      const index = output.indexOf(form);
      if (index !== -1) {
        leaks.push({ label, index, encoding });
        break;
      }
    }
  }
  return leaks;
}

/** Throws if any secret appears in the output. The error names the secret, never its value. */
export function assertNoSecretsLeaked(output: string, secrets: Record<string, string>): void {
  const leaks = findLeakedSecrets(output, secrets);
  if (leaks.length > 0) {
    const names = leaks.map((leak) => `${leak.label} (${leak.encoding}, at offset ${leak.index})`).join(', ');
    throw new Error(`Secret leaked into captured output: ${names}`);
  }
}
