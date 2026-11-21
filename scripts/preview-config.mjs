#!/usr/bin/env node
// Makes the preview's wrangler configs from the real ones (owner 2026-11-19,
// Q10–Q12): the same Workers under the names network-kit-admin-preview and
// network-kit-demo-preview, with storage of their own, the demo bound to the
// preview admin page. Written next to the real configs (paths stay right) and
// ignored by git.
//   node scripts/preview-config.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const jsonc = (text) => JSON.parse(text.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));

const admin = jsonc(readFileSync('admin/wrangler.jsonc', 'utf8'));
admin.name = 'network-kit-admin-preview';
admin.workers_dev = false; // only on nk-admin-preview.trythis.one, behind the zone's rules (B-136)
writeFileSync('admin/wrangler.preview.jsonc', `${JSON.stringify(admin, null, 2)}\n`);

const demo = jsonc(readFileSync('wrangler.jsonc', 'utf8'));
demo.name = 'network-kit-demo-preview';
demo.workers_dev = false; // only on nk-demo-preview.trythis.one (B-136)
demo.services = (demo.services ?? []).map((s) => (s.service === 'network-kit-admin' ? { ...s, service: 'network-kit-admin-preview' } : s));
writeFileSync('wrangler.preview.jsonc', `${JSON.stringify(demo, null, 2)}\n`);
console.log('preview configs written: admin/wrangler.preview.jsonc, wrangler.preview.jsonc');
