// 金额和用量的显示。

const SYMBOL: Readonly<Record<string, string>> = { CNY: '¥', USD: '$', EUR: '€', JPY: '¥' };

// 不到 1 元显示到 4 位小数(费用通常很小)；digits = 固定小数位
export function money(v: number, currency: string, digits?: number): string {
  const sym = SYMBOL[currency] ?? `${currency} `;
  return `${sym}${v.toFixed(digits ?? (v > 0 && v < 1 ? 4 : 2))}`;
}

// 用量数字：整数原样，小数保留 1 位，带千分位
export const amount = (v: number): string => (Number.isInteger(v) ? v : Math.round(v * 10) / 10).toLocaleString();
