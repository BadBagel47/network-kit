// Seals text for the agent (F-047, F-091): gzip, AES-256-GCM with a fresh key,
// the key sealed with the reader's RSA public key (base64 SPKI DER). Only the
// holder of the private key can open it (scripts/open-reports.mjs), so nothing
// readable reaches the public repository or a workflow log.
import { createPublicKey, publicEncrypt, randomBytes, createCipheriv, constants } from 'node:crypto';
import { gzipSync } from 'node:zlib';

/** The sealed block, as lines between BEGIN and END. */
export function seal(text, publicKeyBase64) {
  const publicKey = createPublicKey({ key: Buffer.from(String(publicKeyBase64).replace(/\s+/g, ''), 'base64'), format: 'der', type: 'spki' });
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
  return lines;
}
