// The Custodian port (FR-11, Story 2.8): the contract of quorum approval for `sensitive.quorum`
// actions. The framework ships the interface only; a real implementation (threshold key custody,
// OpenBAO, x/n approval, chained audit) is roadmap.

/** Who asks for access: the same two kinds as the verified token of a request (Story 2.7b). */
export type CustodyRequesterKind = 'user' | 'service';

export interface CustodyRequester {
  kind: CustodyRequesterKind;
  /** `sub` of the verified token: a user id, or `service:<domain>`. */
  subject: string;
  /** The calling service, when a service acts on behalf of the user (Tecton-On-Behalf-Of). */
  via?: { subject: string };
}

/**
 * One access to protected data, described as data only: never an HTTP request, its headers or
 * its URL. A decision is bound to exactly this operation.
 */
export interface SensitiveOperation {
  /** Domain whose data is protected (the manifest `domain`). */
  domain: string;
  /** The `sensitive.quorum` action that needs the data. */
  action: string;
  /** Identifier of the protected key or data, as the domain names it (e.g. `tenant/42/export`). */
  resource: string;
  /** Tenant the key fragments belong to, when the data is per tenant. */
  tenant?: string;
  requestedBy: CustodyRequester;
  /** Free text from the caller for the approvers; the action's `sensitive.description` stays in the manifest. */
  reason?: string;
}

/** The outcome of a custody request. */
export type CustodyDecision =
  | { status: 'approved' }
  | { status: 'pending'; requestId: string }
  | { status: 'denied'; reason?: string };

/**
 * Custody of keys and data protected by quorum approval (FR-11).
 *
 * Where to intercept: at the level of data access, never only in an HTTP route middleware. The
 * persistence adapter or the domain port asks for a decision right before it reads the key or the
 * data. A guard bound to one route is bypassed by another service, a maintenance script or direct
 * access to the database; that is why no method here receives an HTTP request.
 *
 * - `pending` is a result the data-access caller passes back up; the route turns it into the
 *   `202 Accepted` of FR-25 (`pending_approval`, with a URL to poll). The route never decides on
 *   its own, and there is no 202 without a real pending approval.
 * - An `approved` decision holds only for the exact operation submitted (domain, action, resource,
 *   tenant): an implementation must not let it be replayed for another resource.
 * - The audit trail belongs to the provider (a chained audit log is roadmap): callers do not log
 *   the decision themselves.
 * - Without a provider, `sensitive.quorum` actions run normally and every execution through the
 *   HTTP route is logged as unprotected (FR-11). While no data-level interception exists, configuring a provider stops a
 *   service at startup rather than pretend to protect anything (Story 2.8).
 */
export interface KeyCustodyProvider {
  /** Asks for access to the protected data of `operation`. */
  requestAccess(operation: SensitiveOperation): Promise<CustodyDecision>;
  /**
   * The current decision of a pending request, for the same `operation` it was requested for:
   * undefined for an unknown `requestId` or one issued for another operation (an implementation
   * compares them, so a `requestId` never unlocks a different resource).
   */
  decisionOf(requestId: string, operation: SensitiveOperation): Promise<CustodyDecision | undefined>;
}
