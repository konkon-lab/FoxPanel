// 费用柱形图的刻度间隔。

const MULTIPLES = [1, 2, 2.5, 5];
const EMPTY_STEP = 0.05;   // 没有费用时的刻度间隔

// 刻度间隔和标签的小数位：间隔是不超过 max 一半的最大整档(1 / 2 / 2.5 / 5 × 10^k)；间隔(取到 3 位小数)是 0.1 的整数倍时 1 位小数，其余 2 位
export function tickStep(max: number): { step: number; digits: number } {
  const step = max > 0 ? niceStep(max) : EMPTY_STEP;
  return { step, digits: Number.isInteger(Math.round(step * 1000) / 100) ? 1 : 2 };
}

function niceStep(max: number): number {
  const target = max / 2;
  const base = 10 ** Math.floor(Math.log10(target));
  return base * (MULTIPLES.filter(m => m * base <= target).at(-1) ?? 1);
}
