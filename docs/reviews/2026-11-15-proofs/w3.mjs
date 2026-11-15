import { createRoom, hello, sleep } from './wr.mjs';
const idle = Number(process.argv[2] ?? 20_000);
// P2 for real: snapshot newer than the last save, then an idle room.
const room = await createRoom();
const host = await hello(room.code, { hk: room.hostKey, name: 'Host', pk: 'host-pk-xxxxxxxxxxxxxxxxx' });
const a = await hello(room.code, { name: 'A', pk: 'a-pk-xxxxxxxxxxxxxxxxxxxx' });
host.j({ t: 'snap', d: { move: 1 } });
await sleep(4000);
host.j({ t: 'snap', d: { move: 2 } });
for (let n = 1; n <= 5; n++) a.j({ t: 'msg', n, d: `input-${n}` });
await sleep(idle); // nobody sends anything
// P1 for real: A's network switched; a new socket says hello while the old one is still open.
const a2 = await hello(room.code, { name: 'A', pk: 'a-pk-xxxxxxxxxxxxxxxxxxxx' });
console.log(`W3 idle ${idle / 1000}s → welcome.lastN on the replacing socket = ${a2.last('welcome').lastN} (5 were counted)`);
host.close();
await sleep(6000);
console.log('W3 takeover snapshot given to A =', JSON.stringify(a2.last('host')?.snapshot), '(latest sent was {"move":2})');
process.exit(0);
