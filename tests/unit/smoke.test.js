// The smoke test that ships with the kit must pass for every example game,
// and must fail loudly when something is broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'network-kit-smoke-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const optionsFile = resolve('examples/demo/options.js');
const smoke = (...args) => spawnSync(process.execPath, ['src/smoke.mjs', ...args], { encoding: 'utf8', timeout: 30_000 });

test('the smoke test passes with the default options', () => {
  const result = smoke();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /smoke test passed/);
});

for (const game of ['crew', 'turns', 'quiz']) {
  test(`the smoke test passes with the ${game} example's options`, () => {
    const file = join(dir, `${game}.mjs`);
    writeFileSync(file, `export { ${game} as default } from ${JSON.stringify(optionsFile)};\n`);
    const result = smoke('--options', file);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}

test('the smoke test fails with a clear message when the client is broken', async () => {
  const { cpSync } = await import('node:fs');
  const copy = join(dir, 'broken');
  cpSync('src', copy, { recursive: true });
  writeFileSync(join(copy, 'client', 'room.js'), `
    import { NetworkRoom as Real, RoomError } from ${JSON.stringify(resolve('src/client/room.js'))};
    export { RoomError };
    export class NetworkRoom extends Real { send() { return false; } }
  `);
  const result = spawnSync(process.execPath, [join(copy, 'smoke.mjs')], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAILED while: sending messages both ways/);
});

test('the smoke test notices a copy whose entry files are broken', async () => {
  const { cpSync } = await import('node:fs');
  const copy = join(dir, 'copy');
  cpSync('src', copy, { recursive: true });
  writeFileSync(join(copy, 'client', 'index.js'), "export { NetworkRoom } from './room.js';\n"); // share links and QR gone
  const result = spawnSync(process.execPath, [join(copy, 'smoke.mjs')], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not export shareLink/);
});

test('the smoke test handles games whose roles all need a link', () => {
  const file = join(dir, 'keyed.mjs');
  writeFileSync(file, `export default { mode: 'host', ownerRole: 'leader', roles: {
    leader: { seats: 1 }, contestant: { seats: 6, plays: true, needsKey: true }, audience: { seats: 20 } } };\n`);
  const result = smoke('--options', file);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
