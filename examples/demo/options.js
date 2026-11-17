// Room options of the three example games, in a file of their own so they can
// also be loaded outside Cloudflare (network-kit's smoke test does that).
import { memoryRules } from './memory-rules.js';

// The demo is open to anyone, so each room gets a small daily budget.
const maxMessagesPerDay = 150_000;

/** A crew game: one participant's browser runs it, another takes over if it is lost. */
export const crew = {
  mode: 'host',
  takeover: true,
  takeoverMs: 4_000,
  places: ['captain', 'gunner', 'engineer'],
  roles: { player: { seats: 3 }, viewer: { seats: 4 } },
  autoPauseMs: 15_000,
  maxMessagesPerDay,
};

/** A turn-based memory game with its rules in the room. */
export const turns = {
  mode: 'server',
  codeLength: 6,
  rules: memoryRules,
  roles: { player: { seats: 4 }, viewer: { seats: 2 } },
  lateJoin: 'never',
  lateJoinChoices: ['never'],
  ownerLeave: 'pass',
  passOwnerAfterMs: 30_000,
  countdownMs: 0,
  maxMessagesPerDay,
};

/** A quiz: the leader runs it without playing, and nobody may take over. */
export const quiz = {
  mode: 'host',
  roles: { leader: { seats: 1, plays: false }, player: { seats: 12 }, viewer: { seats: 4 } },
  ownerRole: 'leader',
  lateJoin: 'next',
  countdownMs: 0,
  closeAfterHostAwayMs: 30 * 60_000,
  maxMessagesPerDay,
};

export default crew;
