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
if (!usage.available.length) process.exitCode = 1;
