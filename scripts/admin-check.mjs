// Checks the admin page's Cloudflare queries against the real API (run by
// .github/workflows/deploy-admin.yml). Prints which fields each dataset
// offers, any notes, and today's usage per game. Prints no secrets.
//   CLOUDFLARE_ANALYTICS_TOKEN=... [CLOUDFLARE_ACCOUNT_ID=...] node scripts/admin-check.mjs
import { CloudflareAnalytics } from '../admin/analytics.js';
import { METRICS } from '../admin/limits.js';

const token = process.env.CLOUDFLARE_ANALYTICS_TOKEN;
if (!token) {
  console.log('CLOUDFLARE_ANALYTICS_TOKEN is not set; nothing to check.');
  process.exit(0);
}
const analytics = new CloudflareAnalytics({ token, accountId: process.env.CLOUDFLARE_ACCOUNT_ID || null });
const usage = await analytics.usage({ days: 31 });
console.log('Datasets:');
for (const [key, shape] of Object.entries(analytics.shapes)) console.log(`  ${key}: ${JSON.stringify(shape)}`);
console.log(`Metrics shown: ${usage.available.join(', ') || 'none'}`);
for (const note of usage.notes) console.log(`Note: ${note}`);
console.log(`Today (${usage.today} UTC):`);
for (const game of usage.games) {
  const parts = METRICS.filter((m) => usage.available.includes(m.key))
    .map((m) => `${m.key}=${Math.round(game.daily[m.key][usage.today] * 10) / 10}`);
  // B-069: all room requests in the statistics, and the incoming WebSocket messages among them.
  parts.push(`doRequestsAll=${game.daily.doRequestsAll[usage.today]}`, `doMessages=${game.daily.doMessages[usage.today]}`);
  console.log(`  ${game.name}: ${parts.join(' ')}`);
}
// B-069: what the room datasets offer, to see how incoming WebSocket messages are reported.
try {
  const { data } = await analytics.graphql('{ __schema { queryType { name } } }');
  const viewer = await analytics.fieldType(data.__schema.queryType.name, 'viewer');
  const accounts = await analytics.fieldType(viewer.type.name, 'accounts');
  for (const name of ['durableObjectsInvocationsAdaptiveGroups', 'durableObjectsPeriodicGroups']) {
    const found = await analytics.fieldType(accounts.type.name, name);
    if (!found) continue;
    const blocks = {};
    for (const f of (await analytics.type(found.type.name))?.fields ?? []) {
      const t = await analytics.fieldType(found.type.name, f.name);
      const inner = t?.type?.name ? (await analytics.type(t.type.name))?.fields : null;
      blocks[f.name] = inner ? inner.map((x) => x.name) : '(value)';
    }
    console.log(`${name}: ${JSON.stringify(blocks)}`);
  }
} catch (e) {
  console.log(`Could not describe the room datasets: ${e.message}`);
}
if (!usage.available.length) process.exitCode = 1;
