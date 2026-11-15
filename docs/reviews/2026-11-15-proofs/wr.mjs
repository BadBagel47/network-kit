// Raw WebSocket proofs against the local demo Worker (wrangler dev on :8799).
const BASE = 'http://127.0.0.1:8799';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function createRoom(path = '/rooms') {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return res.json();
}
export function raw(code, path = '/rooms') {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}${path}/${code}/ws`);
  const got = [];
  ws.closedWith = null;
  ws.onmessage = (e) => got.push(e.data === 'pong' ? { t: 'pong' } : JSON.parse(e.data));
  ws.onclose = (e) => { ws.closedWith = { code: e.code, reason: e.reason }; };
  ws.got = got;
  ws.last = (t) => got.filter((m) => m.t === t).at(-1);
  ws.ready = new Promise((r) => { ws.onopen = r; });
  ws.j = (m) => ws.send(JSON.stringify(m));
  return ws;
}
export async function hello(code, o = {}, path) {
  const ws = raw(code, path);
  await ws.ready;
  ws.j({ t: 'hello', v: 1, pk: o.pk ?? `pk-${Math.random().toString(36).slice(2)}-xxxxxxxxxxxx`, sid: o.sid ?? 's1', name: o.name ?? 'P', role: o.role, key: o.key, hk: o.hk });
  for (let i = 0; i < 100 && !ws.last('welcome') && !ws.closedWith; i++) await sleep(20);
  ws.id = ws.last('welcome')?.you.id;
  return ws;
}
export { sleep, BASE };
