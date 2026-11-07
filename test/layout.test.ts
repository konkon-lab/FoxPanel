import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { layoutWidth, parseLayout } from '../components/keys/src/layout.ts';

const LAYOUT_FILES = ['components/layout-d68/layout.json', 'examples/layout-ru/layout.json'];
const readLayout = (file: string): unknown => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', file), 'utf8'));

test('布局：预装 D68 和俄文示例都合格，每行 16u', () => {
  for (const f of LAYOUT_FILES) {
    const r = parseLayout(readLayout(f));
    assert.ok(r.ok, f);
    assert.equal(r.layout.rows.length, 5);
    for (const row of r.layout.rows) assert.equal(row.reduce((s, k) => s + k.units, 0), 16, f);
    assert.equal(layoutWidth(r.layout), 16);
  }
});

test('布局：缺动作、动作多于一个、未知 code / fn、text / dual 不是两个 1–8 个字符的字符串、units 太宽、重复 id 都拒绝', () => {
  const bad = (keys: unknown[], re: RegExp): void => {
    const r = parseLayout({ rows: [keys] });
    assert.ok(!r.ok && r.errors.some(e => re.test(e)), JSON.stringify(r));
  };
  bad([{ id: 'a' }], /code、text、fn/);
  bad([{ id: 'a', code: 'KeyA', text: ['a', 'A'] }], /只能一个/);
  bad([{ id: 'a', code: 'KeyÄ' }], /code 不认识/);
  bad([{ id: 'a', code: 'Digit10' }], /code 不认识/);
  bad([{ id: 'a', code: 'constructor' }], /code 不认识/);
  bad([{ id: 'a', fn: 'ctrl' }], /fn/);
  bad([{ id: 'a', text: ['a'] }], /text/);
  bad([{ id: 'a', text: ['a', 'A'.repeat(9)] }], /^第 1 行第 1 个键\(a\) 的 text 要是 \[平时, Shift\] 两个字符串$/);
  bad([{ id: 'a', code: 'KeyA', dual: ['', 'A'] }], /^第 1 行第 1 个键\(a\) 的 dual 要是 \[平时, Shift\] 两个字符串$/);
  bad([{ id: 'a', code: 'KeyA', units: 21 }], /units/);
  bad([{ id: 'a', code: 'KeyA' }, { id: 'a', code: 'KeyB' }], /重复/);
  assert.ok(!parseLayout({ rows: [] }).ok);
  const ok = parseLayout({ rows: [[{ id: 's', spacer: true, units: 0.5 }, { id: 'b', code: 'Backspace', repeat: true, units: 2 }]] });
  assert.ok(ok.ok && ok.layout.rows[0]![1]!.repeat === true && layoutWidth(ok.layout) === 2.5);
});

test('布局：每种键位都认，dual / text 最长 8 个字符', () => {
  const codes = [
    ...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', c => `Key${c}`),
    ...Array.from('0123456789', d => `Digit${d}`),
    'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash',
    'Space', 'Backspace', 'Delete', 'Tab', 'Enter', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  ];
  const rows = [codes.slice(0, 40), codes.slice(40)].map(row => row.map(code => ({ id: code, code, dual: ['a', 'A'.repeat(8)] })));
  const r = parseLayout({ rows });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.layout.rows.flat().map(k => k.code), codes);
});

test('布局：预装 D68 和俄文示例键面上的字、直接插入的字前后没有空白', () => {
  for (const f of LAYOUT_FILES) {
    const r = parseLayout(readLayout(f));
    assert.ok(r.ok, f);
    for (const k of r.layout.rows.flat()) {
      for (const s of [...k.dual ?? [], ...k.text ?? [], k.label ?? '']) assert.equal(s, s.trim(), `${f} ${k.id}`);
    }
  }
});
