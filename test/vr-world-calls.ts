// 留在空间里的面板走一遍常用的操作(连上、总开关、交帧、指和点、抓住挪、双手缩放、改宽度、到面前、重置、收起再恢复、
// 快捷位键、SteamVR 退出后重连)，把这期间对假 Vr 和假显卡的每一次调用写成一行文字。
// test/vr-world-calls.json 是记下来的那一份，test/vr-world-calls.test.ts 逐条比对。

import type { TestContext } from 'node:test';
import type { Caller } from '@konkon-lab/foxpanel-sdk';
import { EVENT_QUIT } from '../components/steamvr/src/openvr.ts';
import { connected, PROBE, shifted } from './vr-helpers.ts';

const WHO: Caller = { component: 'a.other', where: 'process' };
const DIGITS = 9;   // 调用参数里的小数留这么多位

// 一个参数写成文字：小数留 DIGITS 位，句柄一类的大整数带 n，显卡的对象写成「种类#编号」
function show(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(DIGITS);
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${(value as unknown[]).map(show).join(' ')}]`;
  if (typeof value === 'object' && value !== null && 'kind' in value && 'id' in value) return `${String(value.kind)}#${String(value.id)}`;
  return String(value);
}

// 走一遍，返回每一次调用：「vr.方法(参数…)」「gpu.方法(参数…)」，按发生的次序
export function worldCalls(t: TestContext): string[] {
  const rig = connected(t);
  rig.frame(2);
  rig.tap('toggle');
  rig.frame(2);
  rig.page('a.kb').send(1);
  rig.page('a.clock').send(1);
  rig.frame(6);

  // 右手点键盘正中
  rig.aim('right', 'a.kb', 700, 350);
  rig.frame();
  rig.tap('click', 'right');
  rig.away('right');
  rig.frame();

  // 左手抓住时钟挪到一边再松开
  const hold = rig.aim('left', 'a.clock', 200, 100);
  rig.frame();
  rig.press('grab', 'left', true);
  rig.frame(20);
  rig.hand('left', shifted(hold, 0.2, 0.05, -0.1));
  rig.frame(8);
  rig.press('grab', 'left', false);
  rig.frame(2);
  rig.away('left');
  rig.frame();

  // 两只手抓住键盘拉开，右手松开时左手还抓着，随后左手松开
  rig.aim('left', 'a.kb', 349, 349);
  const right = rig.aim('right', 'a.kb', 1049, 349);
  rig.frame();
  rig.press('grab', 'left', true);
  rig.press('grab', 'right', true);
  rig.frame(20);
  rig.hand('right', shifted(right, 0.1333, 0, 0));
  rig.frame(4);
  rig.press('grab', 'right', false);
  rig.frame(2);
  rig.press('grab', 'left', false);
  rig.frame(2);
  rig.away('left');
  rig.away('right');
  rig.page('a.kb').send(2);
  rig.frame(5);

  // 远程服务：改宽度、到面前、重置、全局锁
  void rig.remote.set(WHO, 'a.clock', { meters: 0.5 });
  rig.frame();
  void rig.remote.summon(WHO);
  rig.frame(2);
  void rig.remote.reset(WHO, 'a.clock');
  rig.frame(2);
  void rig.remote.lockAll(WHO, true);
  rig.frame();
  void rig.remote.lockAll(WHO, false);

  // 收起再恢复，快捷位键关掉再打开键盘
  rig.tap('toggle');
  rig.frame(2);
  rig.tap('toggle', 'left');
  rig.frame(2);
  rig.tap('quick1');
  rig.frame(2);
  rig.tap('quick1');
  rig.frame(2);

  // SteamVR 退出，重新连上后恢复
  rig.vr.emit(EVENT_QUIT);
  rig.frame();
  rig.wait(PROBE);
  rig.tap('toggle');
  rig.frame(3);
  rig.page('a.kb').send(3);
  rig.frame(5);
  rig.session.stop();
  return rig.calls.map(c => `${c.on}.${c.name}(${c.args.map(show).join(', ')})`);
}
