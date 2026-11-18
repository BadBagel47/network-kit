// network-kit demo Worker: the example games every release must pass.
//   /rooms  a crew game: one participant's browser runs it, another takes over if it is lost
//   /turns  a turn-based memory game with its rules in the room (memory-rules.js)
//   /quiz   a quiz: the leader runs it without playing, and nobody may take over
import { createRoomServer } from '../../src/server/index.js';
import { crew, turns, quiz } from './options.js';
import { diagRoute, DiagStore } from './diag-store.js';

// Rooms are kept in the EU where the variable says so (not available in local workerd).
const jurisdiction = (env) => env.ROOM_JURISDICTION || null;

const crewRooms = createRoomServer({ ...crew, jurisdiction });
const turnRooms = createRoomServer({ ...turns, binding: 'TURNS', basePath: '/turns', jurisdiction });
const quizRooms = createRoomServer({ ...quiz, binding: 'QUIZ', basePath: '/quiz', jurisdiction });

export const Room = crewRooms.RoomObject;
export const TurnRoom = turnRooms.RoomObject;
export const QuizRoom = quizRooms.RoomObject;
export { DiagStore };

const routes = [['/turns', turnRooms], ['/quiz', quizRooms]];

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/diag') return diagRoute(request, env); // measurement reports (F-047)
    for (const [prefix, server] of routes) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return server.fetch(request, env, ctx);
    }
    return crewRooms.fetch(request, env, ctx);
  },
};
