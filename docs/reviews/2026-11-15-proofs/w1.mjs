import { createRoom, raw, hello, sleep, BASE } from './wr.mjs';
const room = await createRoom();
const host = await hello(room.code, { hk: room.hostKey, name: 'Host' });
for (const n of [1, 2]) {
  const g = await hello(room.code, { name: `ghost${n}`, sid: 'x'.repeat(5000) });
  await sleep(300);
  console.log(`W1 visitor ${n} with a 5000-char sid: welcome=${Boolean(g.last('welcome'))} closed=${JSON.stringify(g.closedWith)} got=${JSON.stringify(g.got.map((m) => m.t))}`);
  g.close();
}
await sleep(1000);
console.log('W1 info after both visitors closed their sockets:', JSON.stringify(await (await fetch(`${BASE}/rooms/${room.code}`)).json()));
host.j({ t: 'cmd', n: 1, c: 'pause' }); // any command → fresh room broadcast
await sleep(300);
console.log('W1 players as the host sees them:', JSON.stringify(host.last('room')?.room.players.map((p) => [p.name, p.status])));
const late = await hello(room.code, { name: 'friend' });
console.log('W1 a real friend joining now:', late.id ? 'welcome' : JSON.stringify(late.closedWith));
host.j({ t: 'cmd', n: 2, c: 'kick', id: host.last('room').room.players[1].id });
await sleep(300);
console.log('W1 after the host kicks one ghost:', JSON.stringify(host.last('room')?.room.players.map((p) => [p.name, p.status])));
process.exit(0);
