import test from 'node:test';
import assert from 'node:assert/strict';
import './window-a-stub.ts';
import { COMPONENT_KINDS } from '../src/shared/manifest.ts';
import { LOCALES } from '../src/shared/types.ts';
import type { SettingDef } from '@konkon-lab/foxpanel-sdk';

const { kindName, textFrom } = await import('../components/_shared/window/i18n.ts');
const { default: shared } = await import('../components/_shared/window/locales.ts');
const { optionsOf, selectOptions } = await import('../components/_shared/window/comp-fields.ts');

test('textFrom：一条文案在各语言下的文字', () => {
  const text = textFrom(shared, 'comp.cancel');
  assert.deepEqual(Object.keys(text).sort(), [...LOCALES].sort());
  assert.deepEqual(text, Object.fromEntries(LOCALES.map(lang => [lang, shared[lang]['comp.cancel']])));
  assert.equal(typeof text === 'object' && text['zh-Hans'], '取消');
});

test('kindName：每个类别在每种语言的共用文案里都有名字', () => {
  assert.equal(kindName('skin'), 'comp.kind.skin');
  for (const kind of COMPONENT_KINDS) {
    for (const lang of LOCALES) assert.ok(shared[lang][`comp.kind.${kind}`], `${lang} 缺 comp.kind.${kind}`);
  }
});

type SelectDef = Extract<SettingDef, { type: 'select' }>;
const voice = (optionsFrom?: SelectDef['optionsFrom']): SettingDef => ({
  key: 'voice', type: 'select', label: '音色', default: 'a',
  options: [{ value: 'a', label: '甲 · 女声' }, { value: 'b', label: { 'zh-Hans': '乙', en: 'B' } }],
  ...(optionsFrom ? { optionsFrom } : {}),
});
const VOICES = [{ id: 'x1', name: '自定义一', model: 'm-1' }, { id: 'x2', name: '', model: '' }, { id: '', name: '没填 ID' }, { id: 'a', name: '和预置重复' }];

test('下拉选项：清单里的标签按「 · 」分出小字，没有自定义时不分组', () => {
  const preset = [{ value: 'a', label: '甲', sub: '女声' }, { value: 'b', label: '乙' }];
  assert.deepEqual(selectOptions(voice(), {}), preset);
  assert.deepEqual(selectOptions(voice({ setting: 'voices', value: 'id', label: 'name' }), { voices: [] }), preset);
  assert.deepEqual(selectOptions(voice({ setting: 'voices', value: 'id', label: 'name' }), { voices: '不是表格' }), preset);
  assert.deepEqual(optionsOf(voice(), {}), preset);
  assert.deepEqual(selectOptions({ key: 'on', type: 'toggle', label: '开关', default: true }, {}), []);
});

test('下拉选项：表格里的各行是自定义一组，排在预置前面；没填值的、和预置重复的不要', () => {
  const options = selectOptions(voice({ setting: 'voices', value: 'id', label: 'name' }), { voices: VOICES });
  assert.deepEqual(options, [
    { value: 'x1', label: '自定义一', group: 'cp.customGroup' },
    { value: 'x2', label: 'x2', group: 'cp.customGroup' },
    { value: 'a', label: '甲', sub: '女声', group: 'cp.presetGroup' },
    { value: 'b', label: '乙', group: 'cp.presetGroup' },
  ]);
});

test('下拉选项：optionsFrom 声明了 sub 时自定义选项带那一列当小字，留空的是「自动」', () => {
  const options = selectOptions(voice({ setting: 'voices', value: 'id', label: 'name', sub: 'model' }), { voices: VOICES });
  assert.deepEqual(options.filter(o => o.group === 'cp.customGroup'), [
    { value: 'x1', label: '自定义一', sub: 'm-1', group: 'cp.customGroup' },
    { value: 'x2', label: 'x2', sub: 'cp.auto', group: 'cp.customGroup' },
  ]);
});
