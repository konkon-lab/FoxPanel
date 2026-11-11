// 组件页里不依赖界面的函数：深拷贝设置的值、把设置的改动记进草稿、把列表里的一项挪到另一项旁边、读标签输入框里的字。

// 深拷贝一个能存成 JSON 的值(store 里的是响应式代理，不能用 structuredClone)
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// 一项设置的改动：owner 是这项设置属于的组件，secret = 这一项是 secret
export interface DraftChange {
  owner: string;
  key: string;
  value: unknown;
  secret: boolean;
}

// 把改动记进 shown(正在显示的组件)的草稿；别的组件的改动不收(换组件时，上一个组件的滑块在卸载前还会交一次值)。
// secret 输入的字记在 secrets(值不是字符串 = 撤销输入)，其余记在 config
export function writeDraft(config: Record<string, unknown>, secrets: Record<string, string>, shown: string, change: DraftChange): void {
  if (change.owner !== shown) return;
  if (!change.secret) config[change.key] = change.value;
  else if (typeof change.value === 'string') secrets[change.key] = change.value;
  else delete secrets[change.key];
}

// 把 id 拖到 target 上时落在它后面还是前面：id 排在 target 前面(往下拖)时落在后面
export function dropsAfter(list: readonly string[], id: string, target: string): boolean {
  const from = list.indexOf(id);
  return from >= 0 && from < list.indexOf(target);
}

// 把 id 挪到 target 旁边(前后按 dropsAfter)，返回新的列表
export function moveNear(list: readonly string[], id: string, target: string): string[] {
  const after = dropsAfter(list, id, target);
  const out = list.filter(x => x !== id);
  const at = out.indexOf(target);
  out.splice(after ? at + 1 : at, 0, id);
  return out;
}

// 标签输入框里的字读成一个标签；空的、读不成数字或不在 min / max 内时是 null
export function readTag(raw: string, item: 'number' | 'string', min = -Infinity, max = Infinity): number | string | null {
  const text = raw.trim();
  if (!text) return null;
  if (item === 'string') return text;
  const n = Number(text);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
