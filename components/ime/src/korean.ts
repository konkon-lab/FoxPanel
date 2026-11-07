// 韩文输入：两套式(두벌식)拼字；韩文模式下拼好的音节直接上屏，韩文汉字模式下整个词留在输入串里，可选成汉字。

import { HangulComposer } from './hangul.ts';
import type { HanjaDict } from './hanja.ts';

// 汉字候选最多给多少个
const MAX_CANDIDATES = 60;

export interface KoCandidate {
  text: string;
  replace: number;   // 替换输入串末尾几个字
}

export class KoreanInput {
  hanja = false;
  private readonly dict: HanjaDict;
  private readonly comp = new HangulComposer();
  private word = '';   // 汉字模式下已拼好、还没上屏的音节

  constructor(dict: HanjaDict) {
    this.dict = dict;
  }

  get composition(): string {
    return this.word + this.comp.composing;
  }

  // 输入一个字母，返回要上屏的文字
  letter(jamo: string): string {
    const done = this.comp.input(jamo);
    if (!done || !this.hanja) return done;
    this.word += done;
    return '';
  }

  // 退一个字母或一个音节；没有可退的返回 false
  backspace(): boolean {
    if (this.comp.backspace()) return true;
    if (!this.word) return false;
    this.word = this.word.slice(0, -1);
    return true;
  }

  // 结束输入，返回整个输入串
  flush(): string {
    const all = this.word + this.comp.flush();
    this.word = '';
    return all;
  }

  // 汉字候选：整个词的排前面，只换最后一个字的排后面
  candidates(): KoCandidate[] {
    const all = this.composition;
    if (!this.hanja || !all) return [];
    const out: KoCandidate[] = this.dict.lookup(all).map(text => ({ text, replace: all.length }));
    if (all.length > 1) for (const text of this.dict.lookup(all.slice(-1))) out.push({ text, replace: 1 });
    return out.slice(0, MAX_CANDIDATES);
  }

  // 选一个候选，返回要上屏的文字
  pick(c: KoCandidate): string {
    const all = this.flush();
    return all.slice(0, all.length - c.replace) + c.text;
  }
}
