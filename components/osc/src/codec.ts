// OSC 编解码：用 node-osc 的 encode / decode，结果收窄成本组件用的消息格式；bundle 展开成消息列表。

import { decode, encode } from 'node-osc';
import type { OscArg } from '@konkon-lab/foxpanel-sdk';
import { isObject } from '../../_shared/util.ts';

export interface OscMessage {
  address: string;
  args: OscArg[];
}

export const BUNDLE = '#bundle';   // bundle 包开头的标记，占着地址的位置

const isArg = (v: unknown): v is OscArg => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

// node-osc 解出的消息或 bundle → 消息列表；只留字符串、布尔、数字参数
function flatten(v: unknown): OscMessage[] {
  if (!isObject(v)) return [];
  if (v['oscType'] === 'bundle') return Array.isArray(v['elements']) ? v['elements'].flatMap(flatten) : [];
  if (typeof v['address'] !== 'string' || !Array.isArray(v['args'])) return [];
  const args = v['args'].map((a: unknown) => (isObject(a) ? a['value'] : undefined)).filter(isArg);
  return [{ address: v['address'], args }];
}

// 包开头的地址(到第一个 0 字节为止)，不解码参数；bundle 包得到 BUNDLE，没有 0 结尾的坏包得到 null
export function packetAddress(buf: Buffer): string | null {
  const end = buf.indexOf(0);
  return end < 0 ? null : buf.toString('utf8', 0, end);
}

// 一个 UDP 包 → 消息列表；坏包抛出异常
export function decodePacket(buf: Buffer): OscMessage[] {
  return flatten(decode(buf) as unknown);
}

// 一条消息：字符串、布尔、整数(int32)、小数(float32)
export function encodeMessage(address: string, args: OscArg[]): Buffer {
  return encode({ oscType: 'message', address, args });
}
