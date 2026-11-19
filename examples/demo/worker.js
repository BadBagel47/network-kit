// network-kit demo Worker: the example games every release must pass.
//   /rooms  a crew game: one participant's browser runs it, another takes over if it is lost
//   /turns  a turn-based memory game with its rules in the room (memory-rules.js)
//   /quiz   a quiz: the leader runs it without playing, and nobody may take over
import { createRoomServer } from '../../src/server/index.js';
import { crew, turns, quiz } from './options.js';
import { diagRoute, DiagStore } from './diag-store.js';
import { visitorKey } from '../../src/shared/visitor.js';

// Rooms are kept in the EU where the variable says so (not available in local workerd).
const jurisdiction = (env) => env.ROOM_JURISDICTION || null;
// Limits per visitor (F-053); the local test runs turn them off, since every test comes from one address.
const limits = (env) => (env.ROOM_LIMITS === 'off' ? null : { createsPerMinute: 10, attemptsPerMinute: 60 });
// The admin page's on/off, budget and emergency stop (F-003, F-004); the demo is one game there.
const admin = { binding: 'NETWORK_KIT_ADMIN', game: 'network-kit-demo' };

const crewRooms = createRoomServer({ ...crew, jurisdiction, limits, admin });
const turnRooms = createRoomServer({ ...turns, binding: 'TURNS', basePath: '/turns', jurisdiction, limits, admin });
const quizRooms = createRoomServer({ ...quiz, binding: 'QUIZ', basePath: '/quiz', jurisdiction, limits, admin });

export const Room = crewRooms.RoomObject;
export const TurnRoom = turnRooms.RoomObject;
export const QuizRoom = quizRooms.RoomObject;
export { DiagStore };

const routes = [['/turns', turnRooms], ['/quiz', quizRooms]];

// The demo's own open paths are limited per visitor and minute (D-111, from the
// review D-093): /invite makes a room without the room server's own checks, and
// /diag stores what it is sent.
const PER_MINUTE = { invite: 5, diag: 10 };
let hits = new Map();
let hitsMinute = 0;
function tooMany(request, env, kind) {
  if (env.ROOM_LIMITS === 'off') return false; // the local test runs
  const minute = Math.floor(Date.now() / 60_000);
  if (minute !== hitsMinute) {
    hits = new Map();
    hitsMinute = minute;
  }
  const key = `${kind}:${visitorKey(request.headers.get('cf-connecting-ip'))}`;
  const n = (hits.get(key) ?? 0) + 1;
  hits.set(key, n);
  return n > PER_MINUTE[kind];
}
const tooManyAnswer = () => Response.json({ error: 'too-many-requests' }, { status: 429, headers: { 'retry-after': '60' } });

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/diag') {
      if (request.method === 'POST' && tooMany(request, env, 'diag')) return tooManyAnswer();
      return diagRoute(request, env); // measurement reports (F-047)
    }
    // An invitation made by the game's server (F-029): a crew room nobody has
    // created from a page yet; the first player to open it becomes owner and host.
    if (pathname === '/invite' && request.method === 'POST') {
      if (tooMany(request, env, 'invite')) return tooManyAnswer();
      const { code, keys } = await crewRooms.createRoom(env);
      return Response.json({ code, key: keys.player.k });
    }
    for (const [prefix, server] of routes) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return server.fetch(request, env, ctx);
    }
    return crewRooms.fetch(request, env, ctx);
  },
};
