#!/usr/bin/env node
// Opens reports sealed by scripts/demo-reports.mjs, with the reader's private key.
//   node scripts/open-reports.mjs <private-key.pem> <file with the workflow log or the sealed block> [picture dir]
// With a picture dir, Playtest reports' pictures (F-091) are written there as
// files and left out of the printed reports.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { privateDecrypt, createDecipheriv, constants } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const [keyFile, logFile, pictureDir] = process.argv.slice(2);
const log = readFileSync(logFile, 'utf8');
const block = log.split('-----BEGIN SEALED REPORTS-----')[1]?.split('-----END SEALED REPORTS-----')[0];
if (!block) throw new Error('No sealed block found');
// Workflow logs put a timestamp in front of every line; keep only the base64 part.
const blob = block.split('\n').map((l) => l.trim().split(/\s+/).pop() ?? '').join('');
const sealed = JSON.parse(Buffer.from(blob, 'base64').toString('utf8'));
const key = privateDecrypt({ key: readFileSync(keyFile), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(sealed.k, 'base64'));
const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
const data = Buffer.concat([decipher.update(Buffer.from(sealed.d, 'base64')), decipher.final()]);
const text = gunzipSync(data).toString('utf8');
if (!pictureDir) process.stdout.write(text);
else {
  const reports = JSON.parse(text);
  mkdirSync(pictureDir, { recursive: true });
  for (const r of reports) {
    for (const p of r.pictures ?? []) {
      const file = join(pictureDir, `${r.id}-${p.id}.${p.type === 'image/png' ? 'png' : 'jpg'}`);
      writeFileSync(file, Buffer.from(p.data, 'base64'));
      p.file = file;
      delete p.data;
    }
  }
  process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
}
