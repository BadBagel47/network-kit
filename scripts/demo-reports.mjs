#!/usr/bin/env node
// Fetches the demo's measurement reports (F-047) and prints them sealed, so
// they can pass through a public workflow log: gzip, AES-256-GCM with a fresh
// key, and that key wrapped with the reader's RSA public key (RSA-OAEP-SHA256).
// Only the holder of the private key can open them (scripts/open-reports.mjs).
//   DEMO_URL=… DIAG_KEY=… PUBLIC_KEY=<base64 SPKI DER> [SINCE=<ms>] [OUT=<file>] node scripts/demo-reports.mjs
import { createPublicKey, publicEncrypt, randomBytes, createCipheriv, constants } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const { DEMO_URL, DIAG_KEY, PUBLIC_KEY, SINCE = '0' } = process.env;
if (!DEMO_URL || !DIAG_KEY || !PUBLIC_KEY) {
  console.error('DEMO_URL, DIAG_KEY and PUBLIC_KEY are needed');
  process.exit(1);
}
const res = await fetch(`${DEMO_URL}/diag?since=${encodeURIComponent(SINCE)}`, { headers: { 'x-diag-key': DIAG_KEY } });
if (!res.ok) {
  console.error(`The demo answered ${res.status}`);
  process.exit(1);
}
const text = await res.text();
const count = JSON.parse(text).length;
const publicKey = createPublicKey({ key: Buffer.from(PUBLIC_KEY.replace(/\s+/g, ''), 'base64'), format: 'der', type: 'spki' });
const key = randomBytes(32);
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const data = Buffer.concat([cipher.update(gzipSync(text)), cipher.final()]);
const sealed = {
  k: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'),
  iv: iv.toString('base64'),
  tag: cipher.getAuthTag().toString('base64'),
  d: data.toString('base64'),
};
const blob = Buffer.from(JSON.stringify(sealed)).toString('base64');
const lines = ['-----BEGIN SEALED REPORTS-----'];
for (let i = 0; i < blob.length; i += 1000) lines.push(blob.slice(i, i + 1000));
lines.push('-----END SEALED REPORTS-----');
console.log(`${count} report(s), sealed for the reader.`);
if (process.env.OUT) writeFileSync(process.env.OUT, `${lines.join('\n')}\n`);
else console.log(lines.join('\n'));
