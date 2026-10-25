import { setTimeout } from 'node:timers/promises';

// Fixture: other Node built-ins stay allowed.
export const wait = setTimeout;
