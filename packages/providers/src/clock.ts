/**
 * Port for the current time (Test Design ASR-1). Every expiry and timestamp in Tecton reads the
 * time through it, so tests can control time instead of waiting for it.
 */
export interface Clock {
  /** Current instant; a new Date on every call. */
  now(): Date;
}

/** The real clock. */
export const systemClock: Clock = {
  now: () => new Date(),
};
