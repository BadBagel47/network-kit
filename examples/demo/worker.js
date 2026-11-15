// network-kit demo Worker: the example games behind https://<demo>/ .
//   /rooms  host-run rooms (a player's browser runs the game), used by the demo page
//   /turns  server-run memory game (rules in memory-rules.js)
import { createRoomServer } from '../../src/server/index.js';
import { memoryRules } from './memory-rules.js';

const jurisdiction = (env) => env.ROOM_JURISDICTION || null;

const rooms = createRoomServer({
  mode: 'host',
  posts: ['captain', 'gunner', 'engineer'],
  limits: { player: 3, viewer: 4 },
  graceMs: 60_000,
  autoPauseMs: 15_000,
  takeoverMs: 4_000,
  jurisdiction,
});

const turns = createRoomServer({
  binding: 'TURNS',
  basePath: '/turns',
  mode: 'server',
  rules: memoryRules,
  limits: { player: 4, viewer: 2 },
  lateJoin: 'never',
  lateJoinChoices: ['never'],
  hostLeave: 'handover',
  countdownMs: 0,
  jurisdiction,
});

export const Room = rooms.RoomObject;
export const TurnRoom = turns.RoomObject;

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/turns' || pathname.startsWith('/turns/')) return turns.fetch(request, env, ctx);
    return rooms.fetch(request, env, ctx);
  },
};
