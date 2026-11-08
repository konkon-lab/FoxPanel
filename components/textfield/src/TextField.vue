<!-- 输入框：文字按字素排开，光标处插着拼音输入串和听写中的半句；点一下放光标，拖动选择，双击选词。
     右端是清空、复制、听写、发送四个同样式的按钮。字形跟输入语言(lang：模式自己的优先，如繁体) -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { KeyboardAction } from '@konkon-lab/foxpanel-sdk';
import { useCtx, useWords } from '../../_shared/vue.ts';
import { TEXT } from './words.ts';
import KbIcon from '../../_shared/Icon.vue';

const ctx = useCtx();
const kb = ctx.kb.state;
const t = useWords(TEXT);
const act = (a: KeyboardAction): void => ctx.kb.act(a);

// 文字里的一个字素，start / end 是它在文字里的位置(UTF-16)
interface Piece { text: string; start: number; end: number }

const GRAPHEMES = new Intl.Segmenter();
const WORDS = new Intl.Segmenter(undefined, { granularity: 'word' });

const pieces = computed<Piece[]>(() => Array.from(GRAPHEMES.segment(kb.text), s => ({ text: s.segment, start: s.index, end: s.index + s.segment.length })));
const selected = (p: Piece): boolean => kb.selEnd > kb.selStart && p.start >= kb.selStart && p.end <= kb.selEnd;
// 光标前后的两段
const before = computed(() => pieces.value.filter(p => p.end <= kb.caret));
const after = computed(() => pieces.value.filter(p => p.start >= kb.caret));

// 点在字的左半 / 右半：光标放在它前面 / 后面
function posOf(e: MouseEvent, p: Piece): number {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return e.clientX < r.left + r.width / 2 ? p.start : p.end;
}

// 拖动选择：按下处到指针处；指针位置没变不重复发
let dragFrom: number | null = null;
let dragTo: number | null = null;
function down(e: MouseEvent, p: Piece | null): void {
  const pos = p ? posOf(e, p) : kb.text.length;
  dragFrom = pos;
  dragTo = null;
  act({ kind: 'caret', position: pos });
}
function over(e: MouseEvent, p: Piece): void {
  if (dragFrom === null || (e.buttons & 1) === 0) return;
  const end = posOf(e, p);
  if (end === dragTo) return;
  dragTo = end;
  act({ kind: 'range', start: dragFrom, end });
}
function up(): void {
  dragFrom = null;
  dragTo = null;
}

// 双击：选中这个词
function word(p: Piece): void {
  for (const w of WORDS.segment(kb.text)) {
    const end = w.index + w.segment.length;
    if (p.start >= w.index && p.start < end) return act({ kind: 'range', start: w.index, end });
  }
}

// 光标保持在可见范围内
const caretEl = ref<HTMLElement | null>(null);
watch(() => [kb.caret, kb.text, kb.composition, kb.compositionCaret, kb.dictation], async () => {
  await nextTick();
  caretEl.value?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});
</script>

<template>
  <div class="field card" :lang="kb.mode.lang ?? kb.pack.lang">
    <div class="text" @mousedown.self="down($event, null)" @mouseup="up" @mouseleave="up">
      <span
        v-for="p in before" :key="p.start" class="ch" :class="{ sel: selected(p) }"
        @mousedown="down($event, p)" @mousemove="over($event, p)" @dblclick="word(p)"
      >{{ p.text }}</span>
      <template v-if="kb.composition">
        <span class="comp">{{ kb.composition.slice(0, kb.compositionCaret) }}</span>
        <span ref="caretEl" class="caret" aria-hidden="true" />
        <span class="comp">{{ kb.composition.slice(kb.compositionCaret) }}</span>
      </template>
      <template v-else>
        <span v-if="kb.dictation" class="dict">{{ kb.dictation }}</span>
        <span ref="caretEl" class="caret" aria-hidden="true" />
      </template>
      <span
        v-for="p in after" :key="p.start" class="ch" :class="{ sel: selected(p) }"
        @mousedown="down($event, p)" @mousemove="over($event, p)" @dblclick="word(p)"
      >{{ p.text }}</span>
    </div>
    <button type="button" class="icon-btn" :aria-label="t.clear" @mousedown="act({ kind: 'clear' })"><kb-icon name="x" :size="24" /></button>
    <button type="button" class="icon-btn" :aria-label="t.copy" @mousedown="act({ kind: 'copy' })"><kb-icon name="copy" :size="24" /></button>
    <button
      type="button" class="icon-btn" :class="{ on: kb.dictating }" :aria-label="t.dictate" :aria-pressed="kb.dictating"
      :disabled="!kb.canDictate && !kb.dictating"
      @mousedown="act({ kind: 'dictate' })"
    ><kb-icon name="mic" :size="24" /></button>
    <button type="button" class="icon-btn" :aria-label="t.send" data-strong @mousedown="act({ kind: 'send' })"><kb-icon name="send" :size="24" /></button>
  </div>
</template>

<style scoped>
.field {
  height: 100%;
  flex: 1;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 6px 0 16px;
  overflow: hidden;
}
.text {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  font-size: 22px;
  white-space: pre;
  overflow: hidden;
}
.ch {
  flex: 0 0 auto;
}
.ch.sel {
  background: var(--accent-soft);
  color: var(--accent);
}
.comp {
  flex: 0 0 auto;
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 5px;
}
.dict {
  flex: 0 0 auto;
  color: var(--sub);
}
.caret {
  flex: 0 0 auto;
  width: 2px;
  height: 28px;
  margin: 0 1px;
  background: var(--accent);
  animation: blink 1.1s steps(1) infinite;
}
@keyframes blink {
  50% { opacity: 0; }
}
.icon-btn:disabled {
  opacity: 0.35;
}
.icon-btn.on {
  color: var(--accent);
  background: var(--accent-soft);
}
</style>
