import { createRoom, hello, sleep, BASE } from './wr.mjs';
for (const size of [10_000, 20_000, 100_000, 400_000]) {
  const room = await createRoom();
  const host = await hello(room.code, { hk: room.hostKey, name: 'Host' });
  const g = await hello(room.code, { name: 'ghost', sid: 'x'.repeat(size) });
  await sleep(400);
  console.log(`W1b sid ${size}: welcome=${Boolean(g.last('welcome'))} closed=${JSON.stringify(g.closedWith)} got=${JSON.stringify(g.got.map((m) => m.t))}`);
  g.close();
  await sleep(700);
  host.j({ t: 'cmd', n: 1, c: 'pause' });
  await sleep(300);
  console.log('   players as the host sees them:', JSON.stringify(host.last('room')?.room.players.map((p) => [p.name, p.status])), 'host closed:', JSON.stringify(host.closedWith));
  host.close();
}
process.exit(0);
