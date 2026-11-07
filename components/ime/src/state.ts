// 主窗口部分收到的语言信息(主进程推来)和搜狗导入的状态
import { reactive, shallowRef } from 'vue';
import type { BusService } from '@konkon-lab/foxpanel-sdk';
import type { LangsInfo } from './channels.ts';

export const info = reactive<LangsInfo>({ langs: [], modes: {}, sogouWords: 0 });
export const sogou = reactive({ importing: false, message: '' });
export const bus = shallowRef<BusService | null>(null);   // 本组件的总线(window.ts 加载时设)
