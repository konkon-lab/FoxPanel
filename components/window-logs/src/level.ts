// 日志页按记录等级过滤：低于设置等级的行不显示(等级来自本组件的设置，在 page.ts 里设好)
import { ref } from 'vue';
import type { LogEntry, LogLevel } from '@konkon-lab/foxpanel-sdk';
import { atLeast } from './rank.ts';

export const level = ref<LogLevel>('info');

export const shown = (l: LogEntry): boolean => atLeast(l.level, level.value);
