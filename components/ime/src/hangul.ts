// 韩文两套式(두벌식)拼字：QWERTY 键位 → 字母(자모)，按初声 / 中声 / 终声拼成音节；
// 复合元音(ㅘ…)、双收音(ㄳ…)，收音后接元音时收音挪到下一个音节。退格按键入顺序一个字母一个字母地退。

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];
const VOWEL_PAIR: Readonly<Record<string, string>> = { ㅗㅏ: 'ㅘ', ㅗㅐ: 'ㅙ', ㅗㅣ: 'ㅚ', ㅜㅓ: 'ㅝ', ㅜㅔ: 'ㅞ', ㅜㅣ: 'ㅟ', ㅡㅣ: 'ㅢ' };
const FINAL_PAIR: Readonly<Record<string, string>> = {
  ㄱㅅ: 'ㄳ', ㄴㅈ: 'ㄵ', ㄴㅎ: 'ㄶ', ㄹㄱ: 'ㄺ', ㄹㅁ: 'ㄻ', ㄹㅂ: 'ㄼ', ㄹㅅ: 'ㄽ', ㄹㅌ: 'ㄾ', ㄹㅍ: 'ㄿ', ㄹㅎ: 'ㅀ', ㅂㅅ: 'ㅄ',
};
// 双收音拆回两个字母
const FINAL_SPLIT: Readonly<Record<string, [string, string]>> = Object.fromEntries(
  Object.entries(FINAL_PAIR).map(([pair, f]) => [f, [...pair] as [string, string]]),
);

// 两套式键位：字母键(小写) → [平时, Shift] 的韩文字母；hangul 引擎的语言没写 keycaps 时键帽也印它
export const HANGUL_KEYS: Readonly<Record<string, readonly [string, string?]>> = {
  q: ['ㅂ', 'ㅃ'], w: ['ㅈ', 'ㅉ'], e: ['ㄷ', 'ㄸ'], r: ['ㄱ', 'ㄲ'], t: ['ㅅ', 'ㅆ'], y: ['ㅛ'], u: ['ㅕ'], i: ['ㅑ'], o: ['ㅐ', 'ㅒ'], p: ['ㅔ', 'ㅖ'],
  a: ['ㅁ'], s: ['ㄴ'], d: ['ㅇ'], f: ['ㄹ'], g: ['ㅎ'], h: ['ㅗ'], j: ['ㅓ'], k: ['ㅏ'], l: ['ㅣ'],
  z: ['ㅋ'], x: ['ㅌ'], c: ['ㅊ'], v: ['ㅍ'], b: ['ㅠ'], n: ['ㅜ'], m: ['ㅡ'],
};

// 字母键(小写)对应的韩文字母；Shift 时有双辅音 / ㅒㅖ 的用它
export function jamoOf(letter: string, shift: boolean): string | null {
  const k = HANGUL_KEYS[letter.toLowerCase()];
  if (!k) return null;
  return (shift ? k[1] : undefined) ?? k[0];
}

const isVowel = (j: string): boolean => JUNG.includes(j);

interface Syllable { cho: string; jung: string; jong: string }

// 拼好的音节：Unicode 码位 = 0xAC00 + (初声序号 × 21 + 中声序号) × 28 + 终声序号；只有初声或中声时是单独的字母
function text(s: Syllable): string {
  if (s.cho && s.jung) return String.fromCharCode(0xac00 + (CHO.indexOf(s.cho) * 21 + JUNG.indexOf(s.jung)) * 28 + JONG.indexOf(s.jong));
  return s.cho + s.jung;
}

export class HangulComposer {
  private s: Syllable = { cho: '', jung: '', jong: '' };
  private keys: string[] = [];   // 当前音节按下的字母，退格时重放

  get composing(): string {
    return text(this.s);
  }

  // 退一个字母；没有在拼的音节时返回 false
  backspace(): boolean {
    if (!this.keys.length) return false;
    const keys = this.keys.slice(0, -1);
    this.reset();
    for (const k of keys) this.input(k);
    return true;
  }

  // 结束拼字，返回还没上屏的部分
  flush(): string {
    const out = text(this.s);
    this.reset();
    return out;
  }

  private reset(): void {
    this.s = { cho: '', jung: '', jong: '' };
    this.keys = [];
  }

  // 另起一个音节
  private start(next: Syllable, keys: string[]): string {
    const out = text(this.s);
    this.s = next;
    this.keys = keys;
    return out;
  }

  // 输入一个字母，返回因此完成(上屏)的音节
  input(j: string): string {
    const { cho, jung, jong } = this.s;
    if (isVowel(j)) {
      if (jong) {
        // 收音挪到下一个音节当初声；双收音只挪后一半
        const split = FINAL_SPLIT[jong];
        const moved = split ? split[1] : jong;
        this.s.jong = split ? split[0] : '';
        return this.start({ cho: moved, jung: j, jong: '' }, [moved, j]);
      }
      if (jung) {
        const pair = VOWEL_PAIR[jung + j];
        if (pair) {
          this.s.jung = pair;
          this.keys.push(j);
          return '';
        }
        return this.start({ cho: '', jung: j, jong: '' }, [j]);
      }
      this.s.jung = j;
      this.keys.push(j);
      return '';
    }
    if (!jung) {
      if (cho) return this.start({ cho: j, jung: '', jong: '' }, [j]);
      this.s.cho = j;
      this.keys.push(j);
      return '';
    }
    if (!jong) {
      if (cho && JONG.includes(j)) {
        this.s.jong = j;
        this.keys.push(j);
        return '';
      }
      return this.start({ cho: j, jung: '', jong: '' }, [j]);
    }
    const pair = FINAL_PAIR[jong + j];
    if (pair) {
      this.s.jong = pair;
      this.keys.push(j);
      return '';
    }
    return this.start({ cho: j, jung: '', jong: '' }, [j]);
  }
}
