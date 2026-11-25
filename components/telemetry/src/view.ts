// 主窗口里的遥测状态：主进程部分推来的那一份(响应式)。

import { shallowRef } from 'vue';
import type { BusService } from '@konkon-lab/foxpanel-sdk';
import { GET, STATE } from './channels.ts';
import { readState, type TelemetryState } from './state.ts';

// 主进程部分的状态；没收到之前为 null
export const telemetry = shallowRef<TelemetryState | null>(null);

// 接上总线：收状态，要一份当前的
export function connect(bus: BusService): void {
  bus.on(STATE, data => {
    const s = readState(data);
    if (s) telemetry.value = s;
  });
  bus.send(GET);
}
