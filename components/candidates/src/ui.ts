// 候选栏的分页状态：候选栏一行、展开后一页各放得下几个，从第几个开始。

import type { KeyboardState } from '@konkon-lab/foxpanel-sdk';
import { reactive } from 'vue';

export const ui = reactive({
  barStart: 0,         // 候选栏从第几个候选开始显示
  barFit: 0,           // 候选栏一行放得下几个
  expanded: false,     // 候选展开
  moreStart: 0,        // 展开时这一页的第一个
  moreFit: 0,          // 展开时一页放得下几个
});

// 输入语言(模式自己的优先，如繁体)：候选栏和展开的候选把它写进自己元素的 lang，字形跟着它
export const inputLang = (kb: Pick<KeyboardState, 'mode' | 'pack'>): string => kb.mode.lang ?? kb.pack.lang;

// 候选栏一行放得下几个由这几项决定，哪一项变了都要重量：候选、起点、字体(跟输入语言和界面语言)
export const barMeasureKey = (kb: Pick<KeyboardState, 'candidates' | 'mode' | 'pack' | 'uiLang'>): readonly unknown[] =>
  [kb.candidates, ui.barStart, inputLang(kb), kb.uiLang];

// el 的子元素排成一行(x)或一页(y)，从头数完整放得下几个
export function countFit(el: HTMLElement, axis: 'x' | 'y'): number {
  const room = axis === 'x' ? el.clientWidth : el.clientHeight;
  let n = 0;
  for (const c of Array.from(el.children) as HTMLElement[]) {
    const end = axis === 'x' ? c.offsetLeft + c.offsetWidth : c.offsetTop + c.offsetHeight;
    if (end > room) break;
    n++;
  }
  return n;
}

// 候选翻页：展开时翻整页，否则翻候选栏
export function pageCandidates(total: number, dir: -1 | 1): void {
  if (ui.expanded) {
    const step = Math.max(1, ui.moreFit);
    ui.moreStart = Math.min(Math.max(0, ui.moreStart + dir * step), Math.max(0, total - 1));
  } else {
    const step = Math.max(1, ui.barFit);
    const next = ui.barStart + dir * step;
    if (next >= 0 && next < total) ui.barStart = next;
    else if (dir < 0) ui.barStart = 0;
  }
}
