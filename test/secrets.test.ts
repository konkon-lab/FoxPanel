import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { maskSecret, SecretStore, type Cipher } from '../src/main/components/secrets.ts';

// 测试用的可逆"加密"
const cipher: Cipher = {
  encrypt: t => Promise.resolve(Buffer.from([...t].reverse().join('')).toString('base64')),
  decrypt: s => Promise.resolve([...Buffer.from(s, 'base64').toString()].reverse().join('')),
};

test('secret：只存加密后的值，能解回来；清除、卸载组件时删掉，重新读文件后还在', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-secret-'));
  const file = path.join(dir, 'secrets.json');
  const store = new SecretStore(file, cipher);
  await store.set('a.tts', 'apiKey', 'sk-123');
  await store.set('a.tts', 'other', 'x');
  await store.set('b.asr', 'apiKey', 'sk-456');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('sk-123'));
  assert.equal(await store.get('a.tts', 'apiKey'), 'sk-123');
  assert.ok(new SecretStore(file, cipher).has('b.asr', 'apiKey'));
  await store.set('a.tts', 'other', '');
  assert.ok(!store.has('a.tts', 'other'));
  store.removeAll('a.tts');
  assert.ok(!store.has('a.tts', 'apiKey'));
  assert.equal(await store.get('a.tts', 'apiKey'), '');
  assert.ok(store.has('b.asr', 'apiKey'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('secret 预览：前 4 位和后 2 位，太短全遮；只在内存，重开后解密一遍才有', async () => {
  assert.equal(maskSecret('sk-3f8a1c0e9b7d4a26b5e1'), 'sk-3••••••e1');
  assert.equal(maskSecret('abc123'), '••••••');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-secret-'));
  const file = path.join(dir, 'secrets.json');
  const store = new SecretStore(file, cipher);
  await store.set('a.tts', 'apiKey', 'sk-abcdefgh12');
  assert.equal(store.hint('a.tts', 'apiKey'), 'sk-a••••••12');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('sk-a'));
  const again = new SecretStore(file, cipher);
  assert.equal(again.hint('a.tts', 'apiKey'), '');
  await again.warm();
  assert.equal(again.hint('a.tts', 'apiKey'), 'sk-a••••••12');
  await again.set('a.tts', 'apiKey', '');
  assert.equal(again.hint('a.tts', 'apiKey'), '');
  fs.rmSync(dir, { recursive: true, force: true });
});
