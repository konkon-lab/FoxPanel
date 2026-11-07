import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HangulComposer, jamoOf } from '../components/ime/src/hangul.ts';
import { HanjaDict } from '../components/ime/src/hanja.ts';
import { KoreanInput } from '../components/ime/src/korean.ts';

// 按 QWERTY 字母打一串，返回 上屏文字 + 正在拼的音节
function type(keys: string): { out: string; comp: string; c: HangulComposer } {
  const c = new HangulComposer();
  let out = '';
  for (const k of keys) {
    const shift = k !== k.toLowerCase();
    out += c.input(jamoOf(k, shift) ?? '');
  }
  return { out, comp: c.composing, c };
}

test('两套式(두벌식)键位：Shift 出双辅音和 ㅒㅖ，没有的照常', () => {
  assert.equal(jamoOf('r', false), 'ㄱ');
  assert.equal(jamoOf('r', true), 'ㄲ');
  assert.equal(jamoOf('p', true), 'ㅖ');
  assert.equal(jamoOf('k', true), 'ㅏ');
  assert.equal(jamoOf('1', false), null);
});

test('拼字：收音后接元音会挪到下一个音节，双收音只挪后一半', () => {
  const a = type('dkssudgktpdy');   // 안녕하세요
  assert.equal(a.out + a.comp, '안녕하세요');
  assert.equal(a.comp, '요');
  assert.equal(type('dlfrdj').out + type('dlfrdj').comp, '읽어');   // ㅇ 不能并进 ㄺ，另起一个音节
  const b = type('dlfrj');            // 읽 + ㅓ：ㄺ 的 ㄱ 挪过去
  assert.equal(b.out + b.comp, '일거');
});

test('拼字：复合元音、双收音、单独的字母', () => {
  assert.equal(type('dhk').comp, '와');
  assert.equal(type('rkqt').comp, '값');
  const solo = type('rr');
  assert.equal(solo.out + solo.comp, 'ㄱㄱ');
  const vowel = type('kk');
  assert.equal(vowel.out + vowel.comp, 'ㅏㅏ');
});

test('退格按键入顺序退一个字母，退完返回 false', () => {
  const { c } = type('rkqt');   // 값
  c.backspace();
  assert.equal(c.composing, '갑');
  c.backspace();
  assert.equal(c.composing, '가');
  c.backspace();
  c.backspace();
  assert.equal(c.composing, '');
  assert.equal(c.backspace(), false);
});

// 小词库：写到临时文件
function koInput(): KoreanInput {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hanja-')), 'hanja.txt');
  fs.writeFileSync(file, '# 注释\n대한:大韓:\n대한:大漢:\n한:韓:나라 한\n한:漢:한수 한\n한:한:\n');
  return new KoreanInput(new HanjaDict(file));
}
const letters = (ko: KoreanInput, keys: string): string => [...keys].map(k => ko.letter(jamoOf(k, false) ?? '')).join('');

test('韩文模式：拼好的音节直接上屏，没有候选', () => {
  const ko = koInput();
  assert.equal(letters(ko, 'eogks'), '대');
  assert.equal(ko.composition, '한');
  assert.deepEqual(ko.candidates(), []);
  assert.equal(ko.flush(), '한');
});

test('韩文汉字模式：整个词留在输入串，先给整词再给末字的汉字', () => {
  const ko = koInput();
  ko.hanja = true;
  assert.equal(letters(ko, 'eogks'), '');
  assert.equal(ko.composition, '대한');
  const c = ko.candidates();
  assert.deepEqual(c.map(x => x.text), ['大韓', '大漢', '韓', '漢']);
  assert.equal(ko.pick(c[2]!), '대韓');
  assert.equal(ko.composition, '');
});

test('汉字词库：preload 读进来之后查询不用读文件；没预读时查询当场读；读不了时 preload 报错', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hanja-'));
  try {
    const file = path.join(dir, 'hanja.txt');
    fs.writeFileSync(file, '한:韓:\n한:漢:\n한:韓:\n');
    const eager = new HanjaDict(file);
    const loading = eager.preload();
    assert.equal(eager.preload(), loading);
    await loading;
    fs.rmSync(file);
    assert.deepEqual(eager.lookup('한'), ['韓', '漢']);
    assert.deepEqual(eager.lookup('글'), []);
    await eager.preload();

    const missing = new HanjaDict(file);
    await assert.rejects(missing.preload(), /ENOENT/);
    fs.writeFileSync(file, '글:㐎:\n');
    await missing.preload();
    assert.deepEqual(missing.lookup('글'), ['㐎']);
    assert.deepEqual(new HanjaDict(file).lookup('글'), ['㐎']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
