// Start the demo Worker with wrangler dev on a free port (local workerd).
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const freePort = () => new Promise((resolve) => {
  const srv = createServer().listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

export async function startWrangler() {
  const port = await freePort();
  const inspector = await freePort();
  const base = `http://127.0.0.1:${port}`;
  spawnSync(process.execPath, ['scripts/vendor.mjs', 'examples/demo/public/network-kit', '--client-only'], { stdio: 'inherit' });
  const child = spawn('npx', [
    'wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--inspector-port', String(inspector),
    // Local workerd has no jurisdictions; production uses the "eu" var in wrangler.jsonc.
    '--var', 'ROOM_JURISDICTION:', '--var', 'DIAG_KEY:test-diag-key', '--var', 'ROOM_LIMITS:off', '--persist-to', '.wrangler/test-state', '--log-level', 'warn',
  ], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const stop = () => {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
  };
  process.on('exit', stop);
  const started = Date.now();
  for (;;) {
    try {
      if ((await fetch(`${base}/rooms`)).ok) break;
    } catch { /* not up yet */ }
    if (Date.now() - started > 60_000) {
      stop();
      throw new Error(`wrangler dev did not start:\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { base, stop, output: () => output };
}
