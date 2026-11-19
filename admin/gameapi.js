// GameApi (F-003, F-004, F-052, F-058, F-059): what a game's Worker asks the
// admin page over a service binding. Shared live by every game, whatever
// network-kit copy it has, so it only ever grows (F-103): a method or an
// argument is never removed or renamed, and new arguments are optional.
// tests/compat/gameapi.mjs runs the previous release's game Worker against it.
//
// `store` is the admin page's main store (a Durable Object stub with fetch).
export function gameApi(store) {
  const post = (path, body) => store.fetch(`https://store${path}`, { method: 'POST', body: JSON.stringify(body) });
  return {
    /** { open, reason, until, stopped, notices } for the game (its Worker's name); the game tells its network-kit version (F-074). */
    async status(game, mode = null, version = null) {
      const q = new URLSearchParams({ game: String(game), ...(mode ? { mode: String(mode) } : {}), ...(version ? { version: String(version) } : {}) });
      return (await store.fetch(`https://store/status?${q}`)).json();
    },
    /** Is this the owner's admin pass for the game (F-058)? */
    async checkPass(game, token) {
      return (await (await post('/check-pass', { game: String(game), token: String(token ?? '') })).json()).valid === true;
    },
    /** Which lobby a host or guest link belongs to (F-059): { id, role, expires, room } or { error }. */
    async lobby(game, token) {
      return (await post('/lobby-check', { game: String(game), token: String(token ?? '') })).json();
    },
    /** The room the game made for a lobby; the first one stored wins (F-059). */
    async lobbyRoom(game, id, room) {
      return (await post('/lobby-room', { game: String(game), id: String(id), room })).json();
    },
    /** An anonymous connection-quality summary from one of the game's pages (F-052). */
    async measure(game, summary) {
      await post('/measure', { game: String(game), summary });
    },
  };
}
