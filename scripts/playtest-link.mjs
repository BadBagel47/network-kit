#!/usr/bin/env node
// Makes a tester link for the agent (F-121, owner Q30) and prints it sealed, so
// the agent can hand the owner a ready link in the chat and nothing readable
// reaches this public repository. The link lasts a day at most, is marked
// "Från agenten" under Testarlänkar on the admin page and can be revoked there.
// With TEST it is also a start address (owner Q29): opening it runs that test's script.
//   ADMIN_URL=… READ_KEY=… PUBLIC_KEY=<base64 SPKI DER> GAME=<game> PAGE=<the game's page>
//   [TEST=<test id>] [HOURS=24] [LABEL=<short>] [EDGE_BYPASS=…] [OUT=<file>] node scripts/playtest-link.mjs
// Open with: node scripts/open-reports.mjs <private-key.pem> <game>-link.txt
import { writeFileSync } from 'node:fs';
import { seal } from './seal.mjs';

const { ADMIN_URL, READ_KEY, PUBLIC_KEY, GAME = '', PAGE = '', TEST = '', HOURS = '24', LABEL = '' } = process.env;
if (!ADMIN_URL || !READ_KEY || !PUBLIC_KEY || !GAME || !PAGE) {
  console.error('ADMIN_URL, READ_KEY, PUBLIC_KEY, GAME and PAGE are needed');
  process.exit(1);
}
let page;
try {
  page = new URL(PAGE);
  if (page.protocol !== 'https:' && page.hostname !== 'localhost' && page.hostname !== '127.0.0.1') throw new Error('https only');
} catch {
  console.error('PAGE must be the game\'s https address');
  process.exit(1);
}
if (TEST && !/^[A-Za-z0-9_-]{1,40}$/.test(TEST)) {
  console.error('TEST must be a test id from the game\'s list');
  process.exit(1);
}
const headers = { 'x-playtest-key': READ_KEY, 'content-type': 'application/json', ...(process.env.EDGE_BYPASS ? { 'x-trythis-country-bypass': process.env.EDGE_BYPASS } : {}) };
const res = await fetch(`${ADMIN_URL}/playtest/v1/tester`, {
  method: 'POST', headers, body: JSON.stringify({ game: GAME, page: `${page.origin}${page.pathname}`, hours: Number(HOURS) || 24, label: LABEL }),
});
const made = await res.json().catch(() => ({}));
if (!res.ok || !made.token) {
  console.error(`The admin page said ${res.status} ${made.error ?? ''}${made.error === 'too-many' ? ': at most 10 agent links a game a day' : ''}`);
  process.exit(1);
}
const link = new URL(page);
if (TEST) {
  link.searchParams.set('playtest', TEST);
  link.searchParams.set('kor', '');
}
link.hash = `nk-tester=${made.token}`;
const text = JSON.stringify({
  link: link.toString().replace('kor=&', 'kor&').replace(/kor=(#|$)/, 'kor$1'),
  game: GAME,
  test: TEST || null,
  label: made.tester?.label ?? null,
  expires: made.tester?.expires ? new Date(made.tester.expires).toISOString() : null,
  note: 'A tester link for the owner only: it lets the browser that opens it report and record for this game until it expires. Give it to the owner in the chat; never put it in a file, a commit or anywhere public.',
}, null, 2);
const lines = seal(text, PUBLIC_KEY);
console.log(`A tester link for ${GAME}${TEST ? ` (starts ${TEST})` : ''}, sealed for the reader.`);
if (process.env.OUT) writeFileSync(process.env.OUT, `${lines.join('\n')}\n`);
else console.log(lines.join('\n'));
