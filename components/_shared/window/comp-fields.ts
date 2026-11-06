// 组件设置的控件数据：下拉选项(清单里的 + 取自 list 设置的各行)、音频设备列表，改一项设置；组件详情、设置页和仪表盘共用。

import { ref } from 'vue';
import { fox, locale, textOf } from '@konkon-lab/foxpanel-window';
import type { SettingDef } from '@konkon-lab/foxpanel-sdk';
import { t } from './i18n.ts';
import type { DropOption } from './drop-option.ts';

// 选项标签「名字 · 说明」分成名字和小字
function split(label: string): { label: string; sub?: string } {
  const at = label.indexOf(' · ');
  return at < 0 ? { label } : { label: label.slice(0, at), sub: label.slice(at + 3) };
}

// 下拉选项：清单里的是「预置」，取自表格(config 里的 list 设置)的各行是「自定义」，有自定义时分两组。
// optionsFrom 声明了 sub(表格里当小字的那一列)时自定义选项带小字，那一格留空的显示「自动」
export function selectOptions(d: SettingDef, config: Record<string, unknown>): DropOption[] {
  if (d.type !== 'select') return [];
  const preset: DropOption[] = d.options.map(o => ({ value: o.value, ...split(textOf(o.label, locale.value)) }));
  const from = d.optionsFrom;
  const rows = from ? config[from.setting] : undefined;
  const sub = from?.sub;
  const custom: DropOption[] = from && Array.isArray(rows)
    ? (rows as Record<string, string>[]).filter(r => r[from.value] && !preset.some(o => o.value === r[from.value]))
      .map(r => ({ value: r[from.value] ?? '', label: r[from.label] || (r[from.value] ?? ''), ...(sub ? { sub: r[sub] || t('cp.auto') } : {}) }))
    : [];
  if (!custom.length) return preset;
  return [...custom.map(o => ({ ...o, group: t('cp.customGroup') })), ...preset.map(o => ({ ...o, group: t('cp.presetGroup') }))];
}

// 音频设备(主窗口能列出来，不能打开)；变了自动刷新
const devices = ref<MediaDeviceInfo[]>([]);
let watching = false;
async function loadDevices(): Promise<void> {
  devices.value = await navigator.mediaDevices.enumerateDevices();
}

// 输出 / 输入设备选项；空值 = 系统默认
export function deviceOptions(kind: 'audioOutput' | 'audioInput'): DropOption[] {
  if (!watching) {
    watching = true;
    void loadDevices();
    navigator.mediaDevices.addEventListener('devicechange', () => void loadDevices());
  }
  const want = kind === 'audioOutput' ? 'audiooutput' : 'audioinput';
  const list = devices.value.filter(x => x.kind === want && x.deviceId !== 'default' && x.deviceId !== 'communications');
  return [{ value: '', label: t('comp.systemDefault') }, ...list.map(x => ({ value: x.deviceId, label: x.label || x.deviceId.slice(0, 8) }))];
}

// 一个设置项的下拉选项(下拉或音频设备)
export function optionsOf(d: SettingDef, config: Record<string, unknown>): DropOption[] {
  if (d.type === 'audioOutput' || d.type === 'audioInput') return deviceOptions(d.type);
  return selectOptions(d, config);
}

// 改组件的一项设置
export function setConfig(id: string, key: string, value: unknown): void {
  void fox.compSet({ kind: 'configs', id, values: { [key]: value } });
}
