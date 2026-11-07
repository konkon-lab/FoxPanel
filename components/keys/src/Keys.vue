<!-- 键区渲染器：按布局 JSON 画键，宽度按 u 计(1u = 键距 − 间隙)，所有键同色；1u 按最宽一行和行数在插槽里放得下的最大值算。
     语言包带键帽时字母键中间印它的字，左上角拉丁字母，右上角 Shift 的字；语言键按开着的语言包数：两种时印「甲/乙」(当前的加深)，按一下换另一种；多于两种时印当前的简称，打开语言面板；只有一种时不能按；模式键印各模式的字(当前的加深)，按一下换下一个模式，只有一种模式时不能按。
     text 键直接插入文字(两个都是字母时跟字母一样受 Caps 影响)；Shift 按一次管一个字，450 毫秒内连按两次锁定(箭头变实心)；Caps 只影响字母；repeat 的键按住连发 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { KeyboardAction } from '@konkon-lab/foxpanel-sdk';
import { layoutWidth, type KeyDef, type LayoutDef } from './layout.ts';
import { useCtx, useWords } from '../../_shared/vue.ts';
import { TEXT } from './words.ts';
import KbIcon from '../../_shared/Icon.vue';
import { ui } from './ui.ts';

const props = defineProps<{ layout: LayoutDef }>();
const ctx = useCtx();
const kb = ctx.kb.state;
const pack = computed(() => ctx.kb.pack);
const mode = computed(() => ctx.kb.mode);
const t = useWords(TEXT);
const act = (a: KeyboardAction): void => ctx.kb.act(a);

const UNIT_MIN_PX = 16;        // 1u 的下限(像素)
const DOUBLE_SHIFT_MS = 450;   // 两次 Shift 隔得比这短算连按(锁定)
const REPEAT_DELAY_MS = 420;   // 按住这么久开始连发
const REPEAT_EVERY_MS = 55;    // 连发的间隔
const PAIR_SMALL_OVER = 4;     // 语言键上两个简称合起来超过这么多字符时用小字

// 键距 1u：按最宽一行和行数，取插槽里放得下的最大值；内边距和间隙读键区的样式(行间和键间是同一个 --gap)
const box = ref<HTMLElement | null>(null);
const unit = ref(UNIT_MIN_PX);
function fit(host: HTMLElement, keys: HTMLElement): void {
  const cs = getComputedStyle(keys);
  const gap = parseFloat(cs.rowGap) || 0;
  const w = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + gap;
  const h = host.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) + gap;
  unit.value = Math.max(UNIT_MIN_PX, Math.min(w / layoutWidth(props.layout), h / props.layout.rows.length));
}
let ro: ResizeObserver | undefined;
onMounted(() => {
  const keys = box.value;
  const host = keys?.parentElement;
  if (!keys || !host) return;
  fit(host, keys);
  ro = new ResizeObserver(() => fit(host, keys));
  ro.observe(host);
});
onBeforeUnmount(() => ro?.disconnect());

const shifted = computed(() => ui.shift || ui.shiftLock);
// 语言包键帽：字母 → [中间, 右上角]，Shift 按下时两个字对调
const keycaps = computed(() => {
  const out = new Map<string, [string, string]>();
  for (const [letter, [normal, shift]] of Object.entries(pack.value.keycaps ?? {})) {
    out.set(letter, !shift ? [normal, ''] : shifted.value ? [shift, normal] : [normal, shift]);
  }
  return out;
});
const cap = (k: KeyDef): [string, string] | undefined => (k.letter ? keycaps.value.get(k.letter) : undefined);
// 模式键上的字：模式写了 key 用它，没写取名字的第一个字
const modeKeys = computed(() => pack.value.modes.map(m => ({ id: m.id, key: m.key ?? [...ctx.i18n.text(m.label)][0] ?? '', cur: m.id === mode.value.id })));

const langPair = computed(() => kb.packs.length === 2);
const langKeys = computed(() => kb.packs.map(p => ({ id: p.id, short: p.short, lang: p.lang, cur: p.id === pack.value.id })));
const langSmall = computed(() => langKeys.value.reduce((n, l) => n + l.short.length, 0) > PAIR_SMALL_OVER);

// 开着的语言不多于两种时收起语言面板
watch(() => kb.packs.length, n => { if (n <= 2) ui.langOpen = false; });

function langKey(): void {
  if (kb.packs.length > 2) {
    ui.langOpen = !ui.langOpen;
    return;
  }
  const other = kb.packs.find(p => p.id !== pack.value.id);
  if (other) act({ kind: 'lang', lang: other.id });
}

function nextMode(): void {
  const { modes } = pack.value;
  const next = modes[(modes.findIndex(m => m.id === mode.value.id) + 1) % modes.length]!;
  act({ kind: 'lang', lang: pack.value.id, mode: next.id });
}
const width = (k: KeyDef): string => `calc(${k.units} * var(--unit) - var(--gap))`;
const upper = (k: KeyDef): boolean => shifted.value !== ui.caps && !!k.letter;

// text 键：两个都是字母(大小写一对)时跟字母一样受 Caps 影响，否则只看 Shift
const letterLike = (t: [string, string]): boolean => t[0] !== t[1] && t[0].toUpperCase() === t[1];
const textOf = (t: [string, string]): string => ((letterLike(t) ? shifted.value !== ui.caps : shifted.value) ? t[1] : t[0]);

// 模式键、语言键没有第二个可换时不能按
const disabled = (k: KeyDef): boolean => (k.fn === 'mode' && modeKeys.value.length < 2) || (k.fn === 'lang' && kb.packs.length < 2);

// 读屏名字：空格、退格、语言键、模式键
function ariaLabel(k: KeyDef): string | undefined {
  if (k.code === 'Space') return t.value.space;
  if (k.code === 'Backspace') return t.value.backspace;
  if (k.fn === 'lang') return t.value.lang;
  if (k.fn === 'mode') return t.value.mode;
  return undefined;
}

let lastShift = 0;
function shiftTap(): void {
  const now = performance.now();
  if (ui.shiftLock) {
    ui.shiftLock = false;
    ui.shift = false;
  } else if (ui.shift && now - lastShift < DOUBLE_SHIFT_MS) {
    ui.shiftLock = true;
  } else {
    ui.shift = !ui.shift;
  }
  lastShift = now;
}

function press(k: KeyDef): void {
  switch (k.fn) {
    case 'shift': return shiftTap();
    case 'caps': ui.caps = !ui.caps; return;
    case 'pgup': return ctx.kb.page(-1);
    case 'pgdn': return ctx.kb.page(1);
    case 'lang': return langKey();
    case 'mode': return nextMode();
  }
  if (k.text) act({ kind: 'text', text: textOf(k.text) });
  else if (k.code) act({ kind: 'key', code: k.code, shift: k.letter ? upper(k) : shifted.value });
  else return;
  if (ui.shift && !ui.shiftLock && (k.letter || k.dual || k.text)) ui.shift = false;
}

// 按住连发
let delay: ReturnType<typeof setTimeout> | undefined;
let every: ReturnType<typeof setInterval> | undefined;
function release(): void {
  clearTimeout(delay);
  clearInterval(every);
}
function down(k: KeyDef): void {
  release();
  press(k);
  if (!k.repeat) return;
  delay = setTimeout(() => { every = setInterval(() => press(k), REPEAT_EVERY_MS); }, REPEAT_DELAY_MS);
}
document.addEventListener('mouseup', release);
onBeforeUnmount(() => document.removeEventListener('mouseup', release));
</script>

<template>
  <div ref="box" class="keys card" :style="{ '--unit': `${unit}px` }" @mouseleave="release">
    <div v-for="(row, r) in props.layout.rows" :key="r" class="row">
      <template v-for="k in row" :key="k.id">
      <span v-if="k.spacer" class="spacer" :style="{ width: width(k) }" />
      <button
        v-else type="button" class="key" :style="{ width: width(k) }" :disabled="disabled(k)"
        :class="{
          on: (k.fn === 'shift' && shifted) || (k.fn === 'caps' && ui.caps), lock: k.fn === 'shift' && ui.shiftLock,
          'caps-on': k.fn === 'caps' && ui.caps, 'lang-open': k.fn === 'lang' && ui.langOpen,
        }"
        :aria-label="ariaLabel(k)"
        :aria-pressed="k.fn === 'shift' ? shifted : k.fn === 'caps' ? ui.caps : undefined"
        :aria-expanded="k.fn === 'lang' && kb.packs.length > 2 ? ui.langOpen : undefined"
        :data-fn="k.fn" @mousedown="down(k)"
      >
        <template v-if="cap(k)">
          <span class="latin">{{ k.letter }}</span><span v-if="cap(k)?.[1]" class="alt">{{ cap(k)?.[1] }}</span>
          <span class="cap" :lang="pack.lang">{{ cap(k)?.[0] }}</span>
        </template>
        <span v-else-if="k.text && letterLike(k.text)" class="letter">{{ textOf(k.text) }}</span>
        <span v-else-if="k.text" class="dual" :class="{ flip: shifted }">
          <span class="top">{{ k.text[1] }}</span><span class="bottom">{{ k.text[0] }}</span>
        </span>
        <span v-else-if="k.letter" class="letter">{{ upper(k) ? k.letter.toUpperCase() : k.letter }}</span>
        <span v-else-if="k.dual" class="dual" :class="{ flip: shifted }">
          <span class="top">{{ k.dual[1] }}</span><span class="bottom">{{ k.dual[0] }}</span>
        </span>
        <kb-icon v-else-if="k.icon" :name="k.icon === 'shift' && ui.shiftLock ? 'shiftLock' : k.icon" :size="24" />
        <span v-else-if="k.fn === 'mode'" class="pair" :class="{ small: modeKeys.length > 2 }" :lang="pack.lang">
          <template v-for="(m, i) in modeKeys" :key="m.id"><template v-if="i">/</template><b :class="{ cur: m.cur && modeKeys.length > 1 }">{{ m.key }}</b></template>
        </span>
        <span v-else-if="k.fn === 'lang' && langPair" class="pair" :class="{ small: langSmall }">
          <template v-for="(l, i) in langKeys" :key="l.id"><template v-if="i">/</template><b :class="{ cur: l.cur }" :lang="l.lang">{{ l.short }}</b></template>
        </span>
        <span v-else-if="k.fn === 'lang'" class="lang" :lang="pack.lang">{{ pack.short }}<small v-if="kb.packs.length > 2">▴</small></span>
        <span v-else class="label" :class="{ arrow: k.label && k.label.length === 1 }">{{ k.label }}</span>
      </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.keys {
  flex: 0 0 auto !important;
  margin: auto;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  padding: 10px;
}
.spacer {
  flex: 0 0 auto;
}
.row {
  height: calc(var(--unit) - var(--gap));
  display: flex;
  gap: var(--gap);
}
.key {
  position: relative;
  flex: 0 0 auto;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 500;
}
.letter {
  font-size: 21px;
}
.dual {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  line-height: 1;
}
.dual .top {
  font-size: 13px;
  color: var(--sub);
}
.dual .bottom {
  font-size: 20px;
}
/* Shift 按下：上面的字符变成主字 */
.dual.flip .top {
  font-size: 20px;
  color: var(--text);
}
.dual.flip .bottom {
  font-size: 13px;
  color: var(--sub);
}
.label {
  font-size: 14px;
}
.label.arrow {
  font-size: 18px;
}
.cap {
  font-size: 22px;
}
.latin,
.alt {
  position: absolute;
  top: 4px;
  line-height: 1;
  color: var(--sub);
}
.latin {
  left: 6px;
  font-size: 11px;
}
.alt {
  right: 6px;
  font-size: 12px;
}
.pair {
  font-size: 15px;
  color: var(--sub);
}
.pair.small {
  font-size: 13px;
}
.pair b {
  font-weight: 500;
}
.pair b.cur {
  color: var(--text);
  font-weight: 600;
}
.lang {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 18px;
  font-weight: 700;
}
.lang small {
  font-size: 11px;
}
.key:disabled {
  opacity: 0.45;
}
.key.on,
.key.lang-open {
  color: var(--accent);
}
/* Shift 锁定 / Caps 开着：键底也变成浅主色 */
.key.lock,
.key.caps-on,
.key.lang-open {
  background: var(--accent-soft);
  box-shadow: 0 1px 0 var(--edge);
}
</style>
