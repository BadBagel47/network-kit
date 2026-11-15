import { raw, sleep, BASE } from './wr.mjs';
// Private room, uninvited visitor with only the room code: can they keep a socket open and feed the room messages?
const res = await fetch(BASE + '/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { access: 'private' } }) });
const room = await res.json();
const s = raw(room.code);
await s.ready;
for (let i = 0; i < 2000; i++) s.send(i % 2 ? '1' : '{bad json');
await sleep(1500);
console.log('W4 uninvited socket in a private room after 2000 junk messages: closed =', JSON.stringify(s.closedWith), '| replies =', s.got.length, JSON.stringify(s.got[0]));
// 50 idle sockets that never say hello
const many = [];
for (let i = 0; i < 50; i++) many.push(raw(room.code));
await Promise.all(many.map((m) => m.ready));
await sleep(3000);
console.log('W4 50 hello-less sockets still open after 3 s:', many.filter((m) => !m.closedWith).length);
process.exit(0);
