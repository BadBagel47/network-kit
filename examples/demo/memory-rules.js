// A tiny turn-based memory game with its rules on the server (mode: 'server').
// It is network-kit's example game: every release must pass its tests.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PAIRS = 4;

function players(room) {
  return room.players.filter((p) => p.role === 'player' && !p.waiting);
}

function view(game) {
  return {
    type: 'board',
    cards: game.cards.map((face, i) => (game.open.includes(i) || game.matched.includes(i) ? face : null)),
    turn: game.turn,
    scores: game.scores,
    over: game.matched.length === game.cards.length && game.cards.length > 0,
  };
}

function nextTurn(room, game) {
  const list = players(room).filter((p) => p.status === 'online' || p.id === game.turn);
  if (list.length === 0) return null;
  const i = list.findIndex((p) => p.id === game.turn);
  return list[(i + 1) % list.length].id;
}

export const memoryRules = {
  init() {
    return { cards: [], open: [], matched: [], turn: null, scores: {}, locked: false };
  },
  onStart(room) {
    const random = mulberry32(room.seed);
    const cards = [];
    for (let i = 0; i < PAIRS; i++) cards.push(i, i);
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    const scores = {};
    for (const p of players(room)) scores[p.id] = 0;
    room.game = { cards, open: [], matched: [], turn: players(room)[0]?.id ?? null, scores, locked: false };
    room.send('all', view(room.game));
  },
  onJoin(room, player) {
    if (room.game.cards.length) room.send([player.id], view(room.game));
  },
  onBack(room, player) {
    if (room.game.cards.length) room.send([player.id], view(room.game));
  },
  onMessage(room, player, data) {
    const game = room.game;
    if (data?.type !== 'flip' || game.locked || game.turn !== player.id) return;
    const i = data.index;
    if (!Number.isInteger(i) || i < 0 || i >= game.cards.length) return;
    if (game.open.includes(i) || game.matched.includes(i)) return;
    game.open.push(i);
    if (game.open.length === 2) {
      const [a, b] = game.open;
      if (game.cards[a] === game.cards[b]) {
        game.matched.push(a, b);
        game.open = [];
        game.scores[player.id] = (game.scores[player.id] ?? 0) + 1;
        if (game.matched.length === game.cards.length) room.end();
      } else {
        game.locked = true;
        room.setTimer('hide', 800);
      }
    }
    room.save();
    room.send('all', view(game));
  },
  onTimer(room, name) {
    if (name !== 'hide') return;
    const game = room.game;
    game.open = [];
    game.locked = false;
    game.turn = nextTurn(room, game);
    room.save();
    room.send('all', view(game));
  },
  onGone(room, player) {
    const game = room.game;
    if (game.turn === player.id) {
      game.turn = nextTurn(room, game);
      game.open = [];
      game.locked = false;
      room.save();
      room.send('all', view(game));
    }
  },
};
