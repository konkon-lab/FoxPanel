// 输入框文字：内容、光标、选区；删除和移动按完整字素进行，不会拆开 emoji 或组合字符。

const segmenter = new Intl.Segmenter();

// text 中所有字素的起点，末尾附上 text.length
function boundaries(text: string): number[] {
  const out: number[] = [];
  for (const { index } of segmenter.segment(text)) out.push(index);
  out.push(text.length);
  return out;
}

// pos 之前 / 之后最近的字素边界
function prevBoundary(text: string, pos: number): number {
  let best = 0;
  for (const b of boundaries(text)) {
    if (b >= pos) break;
    best = b;
  }
  return best;
}

function nextBoundary(text: string, pos: number): number {
  for (const b of boundaries(text)) if (b > pos) return b;
  return text.length;
}

// 落在字素中间的位置对齐到它之前的边界
function snap(text: string, pos: number): number {
  const p = Math.max(0, Math.min(text.length, pos));
  return boundaries(text).includes(p) ? p : prevBoundary(text, p);
}

export class TextBuffer {
  text = '';
  caret = 0;
  private anchor = 0;   // 选区另一端；等于光标时没有选区

  get selStart(): number {
    return Math.min(this.anchor, this.caret);
  }

  get selEnd(): number {
    return Math.max(this.anchor, this.caret);
  }

  get hasSelection(): boolean {
    return this.anchor !== this.caret;
  }

  get selected(): string {
    return this.text.slice(this.selStart, this.selEnd);
  }

  // 插入到光标处；有选区时替换选中的文字
  insert(s: string): void {
    const a = this.selStart;
    this.text = this.text.slice(0, a) + s + this.text.slice(this.selEnd);
    this.moveTo(a + s.length);
  }

  // 退格 / 删除：有选区时删除选区，否则删一个字素
  backspace(): void {
    if (this.hasSelection) return this.insert('');
    const from = prevBoundary(this.text, this.caret);
    this.text = this.text.slice(0, from) + this.text.slice(this.caret);
    this.moveTo(from);
  }

  deleteForward(): void {
    if (this.hasSelection) return this.insert('');
    const to = nextBoundary(this.text, this.caret);
    this.text = this.text.slice(0, this.caret) + this.text.slice(to);
  }

  moveTo(pos: number): void {
    this.caret = snap(this.text, pos);
    this.anchor = this.caret;
  }

  // 左右移动一个字素；有选区时收到选区对应的一端
  step(dir: -1 | 1): void {
    if (this.hasSelection) return this.moveTo(dir < 0 ? this.selStart : this.selEnd);
    this.moveTo(dir < 0 ? prevBoundary(this.text, this.caret) : nextBoundary(this.text, this.caret));
  }

  select(start: number, end: number): void {
    this.anchor = snap(this.text, start);
    this.caret = snap(this.text, end);
  }

  clear(): void {
    this.text = '';
    this.moveTo(0);
  }
}
