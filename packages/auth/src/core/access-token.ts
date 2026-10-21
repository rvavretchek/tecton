import type { Credential } from './credential.js';

/** What the login returns to the client. */
export interface IssuedAccessToken {
  accessToken: string;
  tokenType: 'Bearer';
  /** Lifetime in seconds. */
  expiresIn: number;
}

/** Port for issuing signed user access tokens (AD-7); the core never touches keys or JOSE. */
export interface AccessTokenIssuer {
  issue(credential: Credential): Promise<IssuedAccessToken>;
  /** `iss` and `aud` of the tokens it signs: the one source for recognizing them later (logout). */
  readonly issuer: string;
  readonly audience: string;
}
