// Shared set-ups for the room core tests.
import { FakeWorld, connect, cmd } from './fake-host.js';

/** A crew game: one participant's browser runs it, and another takes over if it is lost. */
export const CREW = {
  mode: 'host',
  takeover: true,
  takeoverMs: 5_000,
  places: ['captain', 'gunner', 'engineer'],
  roles: { player: { seats: 3 }, viewer: { seats: 2 } },
  graceMs: 60_000,
  autoPauseMs: 20_000,
};

/** A quiz: the leader runs it without playing, and nobody may take over. */
export const QUIZ = {
  mode: 'host',
  roles: { leader: { seats: 1, plays: false }, player: { seats: 12 }, viewer: { seats: 4 } },
  ownerRole: 'leader',
  lateJoin: 'next',
  graceMs: 60_000,
};

/** Create a room and connect its owner (who confirms hosting, as the client does). */
export async function setup(options = CREW, settings = {}) {
  const world = new FakeWorld();
  const core = await world.core(options);
  const created = await core.create(settings, 'ABCDE');
  const owner = await connect(world, core, { name: 'Owner', owner: created.ownerKey, pk: 'owner-player-key-xxxxxxxx' });
  if (core.options.mode === 'host') await cmd(core, owner, 'host-ready');
  return { world, core, created, owner };
}
