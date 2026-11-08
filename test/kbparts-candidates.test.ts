import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { reactive, watch } from 'vue';
import type { KeyboardState } from '@konkon-lab/foxpanel-sdk';
import { barMeasureKey, countFit, inputLang, pageCandidates, ui } from '../components/candidates/src/ui.ts';
import { EMPTY_KEYBOARD } from '../components/ime/src/empty.ts';
import { applySnapshot } from '../src/panel/relay.ts';

// 一排子元素：[起点, 长度]
const strip = (room: number, items: [number, number][], axis: 'x' | 'y'): HTMLElement => ({
  clientWidth: room, clientHeight: room,
  children: items.map(([at, size]) => (axis === 'x' ? { offsetLeft: at, offsetWidth: size } : { offsetTop: at, offsetHeight: size })),
}) as unknown as HTMLElement;

test('候选栏：只数完整放得下的，碰到第一个放不下的就停', () => {
  assert.equal(countFit(strip(100, [[0, 40], [46, 40], [92, 40]], 'x'), 'x'), 2);
  assert.equal(countFit(strip(100, [[0, 50], [50, 50]], 'x'), 'x'), 2);
  assert.equal(countFit(strip(100, [[0, 120], [0, 10]], 'x'), 'x'), 0);
  assert.equal(countFit(strip(100, [], 'x'), 'x'), 0);
  // 展开页按行排：超出底边的那一行起都不算
  assert.equal(countFit(strip(110, [[0, 52], [0, 52], [60, 52], [60, 52]], 'y'), 'y'), 2);
});

test('候选栏：收起时按一行的个数翻，翻不过头；展开时按一页的个数翻', () => {
  Object.assign(ui, { barStart: 0, barFit: 5, expanded: false, moreStart: 0, moreFit: 20 });
  pageCandidates(12, 1);
  assert.equal(ui.barStart, 5);
  pageCandidates(12, 1);
  assert.equal(ui.barStart, 10);
  pageCandidates(12, 1);
  assert.equal(ui.barStart, 10);
  pageCandidates(12, -1);
  assert.equal(ui.barStart, 5);
  ui.barStart = 3;
  pageCandidates(12, -1);
  assert.equal(ui.barStart, 0);
  // 一行放得下几个还没量出来时一次翻一个
  ui.barFit = 0;
  pageCandidates(12, 1);
  assert.equal(ui.barStart, 1);

  Object.assign(ui, { expanded: true, moreStart: 0, moreFit: 20 });
  pageCandidates(50, 1);
  assert.equal(ui.moreStart, 20);
  pageCandidates(50, 1);
  pageCandidates(50, 1);
  assert.equal(ui.moreStart, 49);
  pageCandidates(50, -1);
  pageCandidates(50, -1);
  pageCandidates(50, -1);
  assert.equal(ui.moreStart, 0);
  assert.equal(ui.barStart, 1);
});

test('候选栏：候选、起点、输入语言、界面语言变了要重量，只变文字不重量', () => {
  ui.barStart = 0;
  const pack = { ...EMPTY_KEYBOARD.pack, id: 'zh', lang: 'zh-Hans' };
  const base: KeyboardState = {
    ...EMPTY_KEYBOARD, lang: 'zh', packs: [pack], pack, mode: { id: 'simplified', label: '简体' },
    composition: 'ni', candidates: [{ index: 0, text: '你' }, { index: 1, text: '尼' }],
  };
  // 宿主每次推来的都是结构化克隆出来的新对象
  const kb = reactive<KeyboardState>(structuredClone(base));
  let runs = 0;
  const stop = watch(() => barMeasureKey(kb), () => { runs++; }, { flush: 'sync' });
  // 推一次状态(或做一个改动)，返回要不要重量
  const remeasures = (change: Partial<KeyboardState> | (() => void)): boolean => {
    const before = runs;
    if (typeof change === 'function') change();
    else applySnapshot(kb, structuredClone({ ...base, ...change }));
    return runs > before;
  };

  assert.equal(remeasures({}), false);
  assert.equal(remeasures({ text: 'abc', caret: 3, selStart: 3, selEnd: 3 }), false);
  assert.equal(remeasures({ dictating: true, dictation: '你好' }), false);
  // 界面语言：输入语言没有专门字体时候选跟它的字体
  assert.equal(remeasures({ uiLang: 'ja' }), true);
  assert.equal(remeasures({ uiLang: 'ja', text: 'abc' }), false);
  // 输入语言：模式自己的，没有时是语言包的
  assert.equal(remeasures({ mode: { id: 'traditional', label: '繁体', lang: 'zh-Hant' } }), true);
  const en = { ...pack, id: 'en', lang: 'en' };
  assert.equal(remeasures({ lang: 'en', packs: [pack, en], pack: en }), true);
  assert.equal(remeasures({ candidates: [{ index: 0, text: '你' }] }), true);
  assert.equal(remeasures(() => { ui.barStart = 1; }), true);
  stop();
  ui.barStart = 0;
});

test('候选栏：输入语言是模式自己的，没有时是语言包的；没有输入状态时是 und', () => {
  const pack = { ...EMPTY_KEYBOARD.pack, id: 'zh', lang: 'zh-Hans' };
  assert.equal(inputLang({ pack, mode: { id: 'simplified', label: '简体' } }), 'zh-Hans');
  assert.equal(inputLang({ pack, mode: { id: 'traditional', label: '繁体', lang: 'zh-Hant' } }), 'zh-Hant');
  assert.equal(inputLang(EMPTY_KEYBOARD), 'und');
});

// 源码里组件模板的根元素那一行(模板里第一个标签)
function rootTag(file: string): string {
  const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'components', file), 'utf8');
  return /<template>\s*(<[^>]+>)/.exec(source)?.[1] ?? assert.fail(`${file} 里没有模板`);
}

test('候选栏、展开的候选、输入框：各自把输入语言写进自己根元素的 lang(字形跟输入语言)，宿主不替它们设', () => {
  assert.equal(rootTag('candidates/src/Bar.vue'), '<div class="bar card" :lang="inputLang(kb)">');
  assert.equal(rootTag('candidates/src/More.vue'), '<div class="more card" :lang="inputLang(kb)">');
  assert.equal(rootTag('textfield/src/TextField.vue'), '<div class="field card" :lang="kb.mode.lang ?? kb.pack.lang">');
  // 页面宿主只给根元素和弹层设界面语言，不读输入状态
  const host = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'panel', 'main.ts'), 'utf8');
  assert.match(host, /el\.lang = look\.locale;/);
  assert.equal([...host.matchAll(/\.lang = /g)].length, 2);
});
