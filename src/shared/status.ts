// 组件上报的状态栏项的校验。

import { isText } from './schema.ts';
import { STATUS_LEDS, type StatusItem } from './types.ts';
import { isObject } from './util.ts';

const isLed = (v: unknown): v is StatusItem['led'] => (STATUS_LEDS as readonly unknown[]).includes(v);

// 组件上报的状态栏项：格式不对返回 null
export function parseStatusItem(v: unknown): StatusItem | null {
  if (!isObject(v) || !isLed(v['led']) || !isText(v['label'])) return null;
  const item: StatusItem = { led: v['led'], label: v['label'] };
  if (isText(v['value'])) item.value = v['value'];
  if (isText(v['state'])) item.state = v['state'];
  if (Array.isArray(v['rows'])) {
    item.rows = v['rows'].flatMap((r: unknown) => (isObject(r) && isText(r['label']) && isText(r['value']) ? [{ label: r['label'], value: r['value'] }] : []));
  }
  return item;
}
