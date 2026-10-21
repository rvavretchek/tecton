// In-memory TokenRevocationStore for tests without Docker (Story 2.5). Same contract as the port of
// @tecton/providers, typed structurally because tests/support depends on no package. Never for
// production: revocations would not reach the other services (FR-14).

export interface MemoryTokenRevocationStore {
  revokeToken(token: { tokenId: string; expiresAt: Date }): Promise<void>;
  revokeSubject(revocation: { subject: string; at: Date }): Promise<void>;
  isRevoked(token: { tokenId: string; subject: string; issuedAt: Date }): Promise<boolean>;
  close(): Promise<void>;
  /** While true, every call throws the `unavailable` error (Valkey down). */
  setUnavailable(unavailable: boolean): void;
  revokedTokens(): Array<{ tokenId: string; expiresAt: Date }>;
  revokedSubjects(): Array<{ subject: string; at: Date }>;
}

/** `unavailable` builds the error the code under test expects (RevocationStoreUnavailableError). */
export function createMemoryTokenRevocationStore(unavailable: () => Error): MemoryTokenRevocationStore {
  const tokens = new Map<string, Date>();
  const subjects = new Map<string, Date>();
  let down = false;
  const check = () => {
    if (down) throw unavailable();
  };
  return {
    async revokeToken({ tokenId, expiresAt }) {
      check();
      tokens.set(tokenId, new Date(expiresAt));
    },
    async revokeSubject({ subject, at }) {
      check();
      const current = subjects.get(subject);
      if (!current || current.getTime() < at.getTime()) subjects.set(subject, new Date(at));
    },
    async isRevoked({ tokenId, subject, issuedAt }) {
      check();
      if (tokens.has(tokenId)) return true;
      const at = subjects.get(subject);
      return at !== undefined && issuedAt.getTime() <= at.getTime();
    },
    async close() {},
    setUnavailable: (value) => void (down = value),
    revokedTokens: () => [...tokens].map(([tokenId, expiresAt]) => ({ tokenId, expiresAt: new Date(expiresAt) })),
    revokedSubjects: () => [...subjects].map(([subject, at]) => ({ subject, at: new Date(at) })),
  };
}
