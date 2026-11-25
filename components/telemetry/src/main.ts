// 遥测组件的主进程部分：程序开着时按间隔把心跳(设备标识、会话标识、程序版本)发给接收地址，用来统计在线和活跃。
// 发不发由 state.ts 的 whyOff 判断；状态经总线给主窗口部分。发不出去的心跳不留、不补发。

import crypto from 'node:crypto';
import type { MainContext } from '@konkon-lab/foxpanel-sdk';
import { errorText } from '../../_shared/util.ts';
import { postBeat, startBeats, type Beat } from './beat.ts';
import { GET, STATE } from './channels.ts';
import { deviceId, randomDevice, readMachineGuid } from './device.ts';
import { ENDPOINT } from './endpoint.ts';
import { whyOff, type TelemetryState } from './state.ts';

const DEVICE_KEY = 'device';   // 组件数据里的键：读不到 MachineGuid 时用的随机设备标识

// 会话标识：组件进程每次启动生成一个，只在内存里
const SESSION = crypto.randomUUID();

export interface TelemetryDeps {
  endpoint: string;                                     // 接收地址，空 = 不发送
  env: Readonly<Record<string, string | undefined>>;    // 环境变量
  machineGuid(): Promise<string | null>;                // 本机的 MachineGuid，读不到为 null
  post(endpoint: string, beat: Beat): Promise<void>;    // 发一条心跳，没收下时失败
}

export function telemetry(deps: TelemetryDeps): { name: string; apply(ctx: MainContext): void } {
  return {
    name: 'yanuo.telemetry',
    apply(ctx) {
      const enabled = ctx.config['enabled'] !== false;
      let device = '';
      let stop: (() => void) | null = null;   // 停下心跳；null = 没在发
      let failed = false;                     // 这次加载里记过发送失败的日志了
      let closed = false;                     // 组件已卸载

      const state = (): TelemetryState => ({
        device, session: SESSION,
        off: whyOff({ endpoint: deps.endpoint, packaged: ctx.app.info.packaged, env: deps.env, enabled }),
      });

      const send = (): void => {
        deps.post(deps.endpoint, { v: 1, device, session: SESSION, app: ctx.app.info.version }).catch((e: unknown) => {
          if (failed || closed) return;
          failed = true;
          ctx.log(`heartbeat not sent: ${errorText(e)}`, 'warn');
        });
      };

      // 设备标识：MachineGuid 算出的；读不到时用组件数据里存着的随机值(没有就生成一个存下)
      const loadDevice = async (): Promise<string> => {
        const guid = await deps.machineGuid();
        if (guid) return deviceId(guid);
        const stored = await ctx.storage.get(DEVICE_KEY);
        if (typeof stored === 'string' && stored) return stored;
        const made = randomDevice();
        await ctx.storage.set(DEVICE_KEY, made);
        return made;
      };

      // 取到设备标识后：该发就开始心跳，把状态告诉主窗口，之后主窗口要时再给
      const start = async (): Promise<void> => {
        const id = await loadDevice();
        if (closed) return;
        device = id;
        const s = state();
        if (s.off === null) stop = startBeats(send);
        ctx.log(s.off === null ? 'heartbeat on' : `heartbeat off: ${s.off}`);
        ctx.bus.on(GET, () => ctx.bus.send(STATE, state()));
        ctx.bus.send(STATE, s);
      };

      ctx.effect(() => {
        start().catch((e: unknown) => ctx.log(`not started: ${errorText(e)}`, 'error'));
        return () => {
          closed = true;
          stop?.();
          stop = null;
        };
      });
    },
  };
}

export default telemetry({ endpoint: ENDPOINT, env: process.env, machineGuid: readMachineGuid, post: postBeat });
