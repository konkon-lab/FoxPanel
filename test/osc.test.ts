import test from 'node:test';
import assert from 'node:assert/strict';
import { BUNDLE, decodePacket, encodeMessage, packetAddress } from '../components/osc/src/codec.ts';

// 按 OSC 规则编码：字符串 0 结尾并补齐到 4 字节
function pad(s: string): Buffer {
  const b = Buffer.from(s + '\0');
  return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
}

function floatMsg(address: string, v: number): Buffer {
  const arg = Buffer.alloc(4);
  arg.writeFloatBE(v);
  return Buffer.concat([pad(address), pad(',f'), arg]);
}

function int32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
}

test('解码 float 消息', () => {
  assert.deepEqual(decodePacket(floatMsg('/avatar/parameters/Contact_Front_1', 0.25)), [
    { address: '/avatar/parameters/Contact_Front_1', args: [0.25] },
  ]);
});

test('解码 bool 消息', () => {
  const t = Buffer.concat([pad('/avatar/parameters/Toggle_Lower'), pad(',T')]);
  assert.deepEqual(decodePacket(t)[0]?.args, [true]);
});

test('解码 bundle 里的多条消息', () => {
  const a = floatMsg('/a', 1);
  const b = floatMsg('/b', 0);
  const bundle = Buffer.concat([pad('#bundle'), Buffer.alloc(8), int32(a.length), a, int32(b.length), b]);
  assert.deepEqual(decodePacket(bundle).map(m => m.address), ['/a', '/b']);
});

test('编码：聊天框消息(中文字符串 + 两个布尔)能被解码回来', () => {
  const buf = encodeMessage('/chatbox/input', ['今晚去哪个世界', true, false]);
  assert.equal(buf.length % 4, 0);
  assert.deepEqual(decodePacket(buf)[0], { address: '/chatbox/input', args: ['今晚去哪个世界', true, false] });
  assert.deepEqual(decodePacket(encodeMessage('/a', [3, 0.5]))[0], { address: '/a', args: [3, 0.5] });
});

test('包开头的地址：不解码就能读出，和解码结果一致', () => {
  assert.equal(packetAddress(floatMsg('/avatar/parameters/MuteSelf', 1)), '/avatar/parameters/MuteSelf');
  const named = encodeMessage('/avatar/parameters/耳朵', [true]);
  assert.equal(packetAddress(named), decodePacket(named)[0]?.address);
  assert.equal(packetAddress(Buffer.concat([pad('#bundle'), Buffer.alloc(8)])), BUNDLE);
  assert.equal(packetAddress(Buffer.from('/no-terminator')), null);
  assert.equal(packetAddress(Buffer.alloc(0)), null);
});
