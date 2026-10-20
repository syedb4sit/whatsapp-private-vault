import crypto from 'crypto';
import { config } from '../config.js';

const KEY = Buffer.from(config.encryptionKey.padEnd(32).slice(0, 32));
const ALG = 'aes-256-gcm';

export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, KEY, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString('hex'),
    enc: enc.toString('hex'),
    tag: tag.toString('hex'),
  });
}

export function decrypt(stored) {
  const { iv, enc, tag } = JSON.parse(stored);
  const decipher = crypto.createDecipheriv(ALG, KEY, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(enc, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
