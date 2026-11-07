import test from 'node:test';
import assert from 'node:assert/strict';
import { isKeyCode } from '../components/_shared/keyboard.ts';
import { keyMeaning } from '../components/ime/src/keys.ts';
import { TextBuffer } from '../components/ime/src/text.ts';
import { DEFAULT_KEYBOARD, normalizeKeyboard, parseSettings } from '../components/ime/src/settings.ts';

test('键位：字母按 Shift 换大小写，数字和符号键是标准美式键盘的两个字符', () => {
  assert.deepEqual(keyMeaning('KeyA', false), { char: 'a', letter: true, digit: false });
  assert.equal(keyMeaning('KeyA', true)?.char, 'A');
  assert.deepEqual(keyMeaning('Digit6', true), { char: '^', letter: false, digit: false });
  assert.equal(keyMeaning('Digit6', false)?.digit, true);
  assert.equal(keyMeaning('Backquote', true)?.char, '~');
  assert.equal(keyMeaning('Quote', true)?.char, '"');
  assert.deepEqual(keyMeaning('Space', true), { char: ' ', letter: false, digit: false });
  assert.equal(keyMeaning('Backspace', false), null);
});

test('键位：认得字母、数字、符号、空格和编辑键，别的不认', () => {
  for (const code of ['KeyZ', 'Digit0', 'Slash', 'Space', 'Tab', 'ArrowDown']) assert.ok(isKeyCode(code), code);
  for (const code of ['keya', 'KeyAA', 'F1', 'constructor', '', 3, null]) assert.ok(!isKeyCode(code), String(code));
});

test('输入框：插入、退格按字素删除，emoji 不会拆开', () => {
  const b = new TextBuffer();
  b.insert('你好👍🏻');
  assert.equal(b.caret, b.text.length);
  b.backspace();
  assert.equal(b.text, '你好');
  b.step(-1);
  b.insert('们');
  assert.equal(b.text, '你们好');
  b.deleteForward();
  assert.equal(b.text, '你们');
});

test('输入框：选中一段后插入是替换，退格删除选区；光标落在字素中间会对齐', () => {
  const b = new TextBuffer();
  b.insert('今天去正式服');
  b.select(3, 6);
  assert.equal(b.selected, '正式服');
  b.insert('测试服');
  assert.equal(b.text, '今天去测试服');
  b.select(0, 2);
  b.backspace();
  assert.equal(b.text, '去测试服');
  b.clear();
  b.insert('a👍🏻b');
  b.moveTo(2);   // 在 👍 的代理对中间
  assert.equal(b.caret, 1);
});

test('设置：面板的宽度、挡游戏按键、显示时的摆放归显示方，不是键盘设置', () => {
  assert.deepEqual(Object.keys(DEFAULT_KEYBOARD).sort(), ['autoSend', 'lang', 'modes', 'pinMessage', 'showTyping']);
  assert.deepEqual(parseSettings({ keyboardWidth: 1, blockInput: true, resetPositionOnToggle: true }), {});
});

test('设置：语言、模式格式不对时丢掉', () => {
  const s = normalizeKeyboard({ ...DEFAULT_KEYBOARD, lang: 3, modes: { ja: 'hiragana', ko: 1 } });
  assert.equal(s.lang, DEFAULT_KEYBOARD.lang);
  assert.deepEqual(s.modes, { ja: 'hiragana' });
  assert.deepEqual(normalizeKeyboard({ ...DEFAULT_KEYBOARD, modes: undefined }).modes, {});
});

test('设置：存下来的不是对象时用默认值，缺的项、类型不对的项用默认值，多余的项丢掉', () => {
  assert.deepEqual(normalizeKeyboard(null), DEFAULT_KEYBOARD);
  assert.deepEqual(normalizeKeyboard('x'), DEFAULT_KEYBOARD);
  // 深色不是键盘的设置(归核心的面板外观)：存着的 darkMode 和别的多余的项一样丢掉
  const s = normalizeKeyboard({ pinMessage: true, darkMode: true, showTyping: 'no', autoSend: 1, extra: 1 });
  assert.deepEqual(s, { ...DEFAULT_KEYBOARD, pinMessage: true });
  assert.ok(!('darkMode' in DEFAULT_KEYBOARD));
  assert.deepEqual(Object.keys(s), Object.keys(DEFAULT_KEYBOARD));
});

test('设置：补丁只留格式对的项，盖在现有设置上', () => {
  assert.deepEqual(parseSettings({ pinMessage: true, lang: '', modes: 'x', autoSend: 'yes', darkMode: true }), { pinMessage: true });
  const now = { ...DEFAULT_KEYBOARD, showTyping: false, lang: 'yanuo.lang-ja' };
  assert.deepEqual(normalizeKeyboard({ autoSend: true, lang: 7 }, now), { ...now, autoSend: true });
});
