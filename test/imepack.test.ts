import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ImeDef, ImePack } from '@konkon-lab/foxpanel-sdk';
import { currentPack, FALLBACK_PACK, modeOf, parseIme, schemasOf } from '../components/ime/src/imepack.ts';
import { parseManifest, type Manifest } from '../src/shared/manifest.ts';
import { LangFiles, writeIfChanged } from '../components/ime/src/langs.ts';
import { jamoOf } from '../components/ime/src/hangul.ts';

const pack = (id: string, ime: object): ImePack => ({ ...parseIme(ime, id), id, name: id });

test('当前语言：不在开着的里时回到第一个，一个都没有时用直接打字母；模式不认识时用第一个', () => {
  const ja = pack('yanuo.lang-ja', { schema: 'jaroomaji', modes: [{ id: 'kanji', key: '漢', label: '漢字' }, { id: 'hiragana', key: 'あ', label: 'ひらがな' }] });
  const en = pack('yanuo.lang-en', { schema: 'easy_en' });
  assert.equal(currentPack([ja, en], 'yanuo.lang-zh').id, ja.id);
  assert.equal(currentPack([ja, en], en.id).id, en.id);
  assert.equal(currentPack([], 'x'), FALLBACK_PACK);
  assert.equal(modeOf(ja, { [ja.id]: 'hiragana' }).id, 'hiragana');
  assert.equal(modeOf(ja, { [ja.id]: 'hangul' }).id, 'kanji');
});

test('ime 字段：缺省值、模式和键帽、韩文不要方案、用到的方案', () => {
  const p = parseIme({
    schema: 'jyut6ping3', lang: 'yue',
    modes: [{ id: 'trad', label: { 'zh-Hant': '繁體', en: 'Traditional' }, switches: { simplification: false } }, { id: 'jp', label: 'jp', schema: 'jyutping_jp' }],
    keycaps: { a: ['ㄚ'] },
  }, '粵語');
  assert.equal(p.short, '粵');
  assert.equal(p.engine, 'rime');
  assert.equal(p.enter, 'raw');
  assert.deepEqual(p.modes[0]!.switches, { simplification: false });
  assert.deepEqual(p.keycaps, { a: ['ㄚ'] });
  assert.deepEqual(schemasOf(p), ['jyut6ping3', 'jyutping_jp']);
  assert.deepEqual(parseIme({ schema: 's' }, 'X').modes, [{ id: 'default', label: 'X' }]);
  const ko = parseIme({ engine: 'hangul', modes: [{ id: 'hangul', label: '한글' }] }, '두벌식');
  assert.equal(ko.schema, '');
  assert.deepEqual(schemasOf(ko), []);
});

test('ime 字段：组件名有几种语言时 short 取简体中文(没有取第一个)的第一个字，默认模式的名字跟着组件名', () => {
  const zh = parseIme({ schema: 's' }, { 'zh-Hans': '粤语', en: 'Cantonese' });
  assert.equal(zh.short, '粤');
  assert.deepEqual(zh.modes, [{ id: 'default', label: { 'zh-Hans': '粤语', en: 'Cantonese' } }]);
  const ru = parseIme({ schema: 's' }, { en: 'Russian' });
  assert.equal(ru.short, 'R');
  assert.deepEqual(ru.modes, [{ id: 'default', label: { en: 'Russian' } }]);
});

test('ime 字段：hangul 引擎没写 keycaps 时键帽印两套式字母，写了用写的', () => {
  const ko = parseIme({ engine: 'hangul' }, '두벌식');
  const caps = ko.keycaps ?? {};
  assert.equal(Object.keys(caps).join(''), 'qwertyuiopasdfghjklzxcvbnm');
  for (const [letter, cap] of Object.entries(caps)) {
    const shifted = jamoOf(letter, true);
    assert.deepEqual(cap, shifted === cap[0] ? [jamoOf(letter, false)] : [jamoOf(letter, false), shifted]);
  }
  assert.deepEqual(caps['q'], ['ㅂ', 'ㅃ']);
  assert.deepEqual(caps['k'], ['ㅏ']);
  assert.deepEqual(parseIme({ engine: 'hangul', keycaps: { a: ['x'] } }, 'k').keycaps, { a: ['x'] });
  assert.equal(parseIme({ schema: 's' }, 'x').keycaps, undefined);
  // 预装的韩文语言组件靠这个默认值
  const r = parseManifest(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'components', 'lang-ko', 'component.json'), 'utf8')));
  assert.ok(r.ok);
  assert.deepEqual(parseIme(r.manifest.ime, r.manifest.name).keycaps, caps);
});

test('ime 字段：不对的地方报出原因', () => {
  const bad = (raw: unknown, re: RegExp): void => assert.throws(() => parseIme(raw, 'x'), re);
  bad({}, /schema/);
  bad({ schema: 'a b' }, /方案名/);
  bad({ schema: 's', engine: 'x' }, /engine/);
  bad({ schema: 's', modes: [{ id: 'm' }] }, /label/);
  bad({ schema: 's', modes: [{ id: 'm', label: 'a' }, { id: 'm', label: 'b' }] }, /重复/);
  bad({ schema: 's', modes: [{ id: 'm', label: 'a', output: 'x' }] }, /output/);
  bad({ schema: 's', keycaps: { A: ['a'] } }, /keycaps/);
  const r = parseManifest({ id: 'a.b', kind: 'lang', name: 'x', version: '1.0.0', author: 'a', license: 'MIT' });
  assert.ok(!r.ok && r.errors.some(e => e.includes('ime')));
});

// 在临时目录里做一个语言组件；ime = 清单里的 ime 字段
function lang(root: string, id: string, schema: string, files: Record<string, string>, ime: object = { schema }): { dir: string; manifest: Manifest; ime: ImeDef } {
  const dir = path.join(root, id);
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, 'rime', f)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'rime', f), text);
  }
  fs.mkdirSync(dir, { recursive: true });
  const r = parseManifest({ id, kind: 'lang', name: id, version: '1.0.0', author: 'a', license: 'MIT', ime });
  assert.ok(r.ok);
  return { dir, manifest: r.manifest, ime: parseIme({ schema }, id) };
}

// 临时目录里的 rime 用户目录和内置数据(内置有 clover 方案)
function langDirs(root: string): { user: string; shared: string; record: string } {
  const dirs = { user: path.join(root, 'user'), shared: path.join(root, 'shared'), record: path.join(root, 'files.json') };
  for (const d of [dirs.user, dirs.shared]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(dirs.shared, 'clover.schema.yaml'), '');
  return dirs;
}

test('语言文件：装上的进用户目录，schema_list 跟着变，卸掉的删掉；同名文件和缺方案拒绝', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-lang-'));
  try {
    const dirs = langDirs(root);
    const lf = new LangFiles(dirs, ['clover.custom.yaml']);
    const zh = lang(root, 'yanuo.zh', 'clover', {});
    const demo = lang(root, 'test.demo', 'demo', { 'demo.schema.yaml': 'a', 'demo.dict.yaml': 'b', 'lua/demo.lua': 'c' });
    lf.check(demo, [zh]);

    assert.equal(lf.sync([zh, demo]), true);
    assert.equal(fs.readFileSync(path.join(dirs.user, 'lua', 'demo.lua'), 'utf8'), 'c');
    assert.equal(lf.sync([zh, demo]), false);
    const packs: ImePack[] = [zh, demo].map(c => ({ ...c.ime, id: c.manifest.id, name: c.manifest.name }));
    assert.equal(lf.writeSchemaList(packs), true);
    assert.equal(lf.writeSchemaList(packs), false);
    assert.match(fs.readFileSync(path.join(dirs.user, 'default.custom.yaml'), 'utf8'), /- schema: clover\n {4}- schema: demo\n/);

    const clash = (id: string, files: Record<string, string>, re: RegExp): void =>
      assert.throws(() => lf.check(lang(root, `test.${id}`, id, { [`${id}.schema.yaml`]: '', ...files }), [zh, demo]), re);
    clash('c1', { 'clover.schema.yaml': '' }, /内置文件/);
    clash('c2', { 'demo.dict.yaml': '' }, /test\.demo/);
    clash('c3', { 'clover.custom.yaml': '' }, /程序自己的配置/);
    assert.throws(() => lf.check(lang(root, 'test.c4', 'nope', {}), [zh]), /nope\.schema\.yaml/);

    assert.equal(lf.sync([zh]), true);
    assert.ok(!fs.existsSync(path.join(dirs.user, 'demo.schema.yaml')));
    assert.ok(!fs.existsSync(path.join(dirs.user, 'lua')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('语言文件：apply 跳过 ime 不对、缺方案的组件并记日志，其余的同步进用户目录；没变化时返回没变', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-lang-'));
  try {
    const dirs = langDirs(root);
    const lf = new LangFiles(dirs, []);
    const installed = [
      lang(root, 'yanuo.zh', 'clover', {}),
      lang(root, 'test.demo', 'demo', { 'demo.schema.yaml': 'a' }),
      lang(root, 'test.nope', 'nope', {}),
      lang(root, 'test.bad', 'bad', { 'bad.schema.yaml': '' }, { schema: 'bad', enter: 'x' }),
    ].map(({ dir, manifest }) => ({ dir, manifest }));
    const logs: string[] = [];
    const log = (text: string): void => { logs.push(text); };

    const first = lf.apply(installed, log);
    assert.deepEqual(first.packs.map(p => p.id), ['yanuo.zh', 'test.demo']);
    assert.deepEqual(first.packs[1], { ...parseIme({ schema: 'demo' }, 'test.demo'), id: 'test.demo', name: 'test.demo' });
    assert.equal(first.changed, true);
    assert.deepEqual(logs.map(l => l.split(' ')[0]).sort(), ['test.bad', 'test.nope']);
    assert.match(logs.join('\n'), /nope\.schema\.yaml/);
    assert.equal(fs.readFileSync(path.join(dirs.user, 'demo.schema.yaml'), 'utf8'), 'a');
    assert.ok(!fs.existsSync(path.join(dirs.user, 'bad.schema.yaml')));
    assert.match(fs.readFileSync(path.join(dirs.user, 'default.custom.yaml'), 'utf8'), /- schema: clover\n {4}- schema: demo\n$/);

    assert.equal(lf.apply(installed, log).changed, false);
    const left = lf.apply(installed.slice(0, 1), log);
    assert.deepEqual(left.packs.map(p => p.id), ['yanuo.zh']);
    assert.equal(left.changed, true);
    assert.ok(!fs.existsSync(path.join(dirs.user, 'demo.schema.yaml')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writeIfChanged：内容一样时不写，修改时间不变', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-lang-'));
  try {
    const file = path.join(root, 'a.yaml');
    assert.equal(writeIfChanged(file, 'a'), true);
    const old = new Date(2020, 0, 1);
    fs.utimesSync(file, old, old);
    assert.equal(writeIfChanged(file, 'a'), false);
    assert.equal(fs.statSync(file).mtimeMs, old.getTime());
    assert.equal(writeIfChanged(file, 'b'), true);
    assert.equal(fs.readFileSync(file, 'utf8'), 'b');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
