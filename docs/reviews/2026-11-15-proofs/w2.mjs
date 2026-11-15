import { createRoom, hello, sleep, BASE } from './wr.mjs';
import { NetworkRoom } from '../../../src/client/index.js';
const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
// raw: what does the runtime do with a message over 1 MiB?
{
  const room = await createRoom();
  const host = await hello(room.code, { hk: room.hostKey, name: 'Host' });
  host.j({ t: 'msg', n: 1, d: 'x'.repeat(600_000) });
  await sleep(300);
  console.log('W2 600 kB msg →', JSON.stringify(host.last('err')), 'closed:', JSON.stringify(host.closedWith));
  host.j({ t: 'msg', n: 2, d: 'x'.repeat(1_200_000) });
  await sleep(800);
  console.log('W2 1.2 MB msg →', 'closed:', JSON.stringify(host.closedWith));
}
// real client: a reliable message that the runtime refuses
{
  const host = await NetworkRoom.create(BASE, { name: 'Host', storage: store(), minDelayMs: 100, maxDelayMs: 1000 });
  const a = await NetworkRoom.join(BASE, { code: host.code, name: 'A', storage: store() });
  let welcomes = 0; let drops = 0;
  host.on('welcome', () => { welcomes += 1; });
  a.on('peer', (e) => { if (e.event === 'drop') drops += 1; });
  host.send({ blob: 'x'.repeat(1_200_000) }); // e.g. a game that sends its whole state with send()
  await sleep(6000);
  console.log(`W2 real client, one 1.2 MB reliable send: reconnects in 6 s = ${welcomes}, host "drop" events seen by A = ${drops}, queue = ${host.queue.length}, status = ${host.status}`);
  host.disconnect(); a.disconnect();
}
process.exit(0);
