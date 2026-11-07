import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { activePage } from '../components/shell-classic/src/tabs.ts';
import { REQUIRED, TEXT } from '../components/shell-classic/src/words.ts';
import { parseManifest, PART_KINDS } from '../src/shared/manifest.ts';
import { LOCALES } from '../src/shared/types.ts';

// 经典外壳：键盘面板的根组件。清单、模板里的插槽、缺件提示、页签。

const DIR = path.resolve(import.meta.dirname, '..', 'components', 'shell-classic');
const read = (...parts: string[]): string => fs.readFileSync(path.join(DIR, ...parts), 'utf8');

test('经典外壳的清单：panel 类别，入口在 panel.page，声明五个插槽；不写 requires(输入法关着时面板还在)', () => {
  const r = parseManifest(JSON.parse(read('component.json')));
  if (!r.ok) assert.fail(r.errors.join('；'));
  const m = r.manifest;
  assert.deepEqual([m.id, m.kind, m.page, m.requires, m.uses, m.provides], ['yanuo.shell-classic', 'panel', undefined, undefined, undefined, undefined]);
  assert.deepEqual(m.panel, {
    page: 'panel.js', width: 1400, height: 490, scale: 1, fps: 60, meters: 0.8, minMeters: 0.4, maxMeters: 1.6,
    anchor: 'world', spawn: 'low', glance: false, keep: true, sound: true,
    slots: ['candidates', 'textfield', 'layout', 'sidepage', 'sidebutton'],
  });
  // 插槽名都是部件的类别名
  for (const slot of m.panel?.slots ?? []) assert.ok((PART_KINDS as ReadonlySet<string>).has(slot), slot);
  // 入口的源码是 src/panel.ts(打包成 panel.js)
  assert.ok(fs.existsSync(path.join(DIR, 'src', 'panel.ts')));
  assert.ok(!fs.existsSync(path.join(DIR, 'src', 'page.ts')));
});

test('经典外壳的模板：带 data-slot 的元素和清单声明的插槽一一对应；候选栏、输入框、键区的插槽里各有一条缺件提示', () => {
  const vue = read('src', 'Shell.vue');
  const template = /<template>([\s\S]*)<\/template>/.exec(vue)?.[1] ?? assert.fail('Shell.vue 里没有模板');
  const slots = [...template.matchAll(/data-slot="([\w-]+)"/g)].map(m => m[1]);
  const declared = (JSON.parse(read('component.json')) as { panel: { slots: string[] } }).panel.slots;
  assert.deepEqual([...slots].sort(), [...declared].sort());
  assert.equal(new Set(slots).size, slots.length);
  // 缺件提示直接放在插槽元素里，没有部件时才有
  for (const slot of REQUIRED) {
    const inside = new RegExp(`<div data-slot="${slot}"[^>]*>\\s*<div v-if="missing\\('${slot}'\\)" class="fox-notice">\\{\\{ t\\.${slot} \\}\\}</div>\\s*</div>`);
    assert.match(template, inside, slot);
  }
  assert.equal([...template.matchAll(/class="fox-notice"/g)].length, REQUIRED.length);
  assert.match(vue, /const missing = \(slot: RequiredSlot\): boolean => ctx\.panel\.parts\(slot\)\.length === 0;/);
  // 页签和侧栏页的显示都按面板里 sidepage 插槽的部件来
  assert.match(vue, /const pages = computed\(\(\) => ctx\.panel\.parts\('sidepage'\)\);/);
  assert.match(vue, /for \(const p of pages\.value\) p\.el\.hidden = p\.id !== active\.value;/);
  assert.doesNotMatch(vue, /ctx\.shell|ctx\.kb/);
});

test('经典外壳的缺件提示：三个插槽、五种界面语言都有文字，互不相同', () => {
  assert.deepEqual([...REQUIRED], ['candidates', 'textfield', 'layout']);
  const all = LOCALES.flatMap(lang => REQUIRED.map(slot => TEXT[lang][slot]));
  assert.ok(all.every(Boolean));
  assert.equal(new Set(all).size, LOCALES.length * REQUIRED.length);
});

test('侧栏页的页签：没选过时显示第一页，选过的那页还在就显示它，没了回到第一页；一页都没有时为空', () => {
  const ids = ['a.quick', 'a.numpad', 'a.symbols'];
  assert.equal(activePage(ids, ''), 'a.quick');
  assert.equal(activePage(ids, 'a.numpad'), 'a.numpad');
  assert.equal(activePage(ids, 'a.gone'), 'a.quick');
  assert.equal(activePage(['a.numpad'], 'a.quick'), 'a.numpad');
  assert.equal(activePage([], 'a.quick'), '');
});

test('日夜切换按钮：读面板的深色、调 ctx.panel.setDark，不用 kb；清单不要 keyboard', () => {
  const dir = path.resolve(DIR, '..', 'button-theme');
  const vue = fs.readFileSync(path.join(dir, 'src', 'Theme.vue'), 'utf8');
  assert.match(vue, /const dark = computed\(\(\) => ctx\.panel\.dark\);/);
  assert.match(vue, /@press="ctx\.panel\.setDark\(!dark\)"/);
  assert.doesNotMatch(vue, /ctx\.kb|darkMode/);
  assert.match(fs.readFileSync(path.join(dir, 'src', 'page.ts'), 'utf8'), /slotPlugin\('yanuo\.button-theme', Theme, \['i18n'\]\)/);
  const r = parseManifest(JSON.parse(fs.readFileSync(path.join(dir, 'component.json'), 'utf8')));
  if (!r.ok) assert.fail(r.errors.join('；'));
  assert.deepEqual([r.manifest.kind, r.manifest.requires], ['sidebutton', undefined]);
});
