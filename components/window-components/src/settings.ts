// 设置组件提供的 settings 服务(开着设置组件时有)：登记了的配置项在设置页改，组件页不显示
import { shallowRef } from 'vue';
import type { SettingDef, WindowSettingsService } from '@konkon-lab/foxpanel-sdk';

export const settingsService = shallowRef<WindowSettingsService | null>(null);

export const inSettings = (owner: string, def: SettingDef): boolean => settingsService.value?.edits(owner, def) ?? false;
