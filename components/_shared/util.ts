// 预装组件共用的小函数：外部输入的收窄、错误转文字、本地日期。

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// 抛出的值 → 错误文字
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// 本地日期 YYYY-MM-DD
export function dayOf(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
