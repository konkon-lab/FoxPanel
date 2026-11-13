// 预装组件的版本检查(scripts/preinstalled-check.ts)：内容变了而版本号没升的报出来。

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compare, hashDir, main, readRecord, stamps, type Released } from '../scripts/preinstalled-check.ts';

// 临时的构建目录：每个组件一个文件夹，带清单和一个代码文件
function built(t: TestContext, components: Record<string, { version: string; code: string }>): { dir: string; record: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-preinstalled-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'components');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'preinstalled.json'), '[]');
  for (const [id, c] of Object.entries(components)) write(dir, id, c);
  return { dir, record: path.join(root, 'released.json') };
}

function write(dir: string, id: string, c: { version: string; code: string }): void {
  fs.mkdirSync(path.join(dir, id, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, id, 'component.json'), JSON.stringify({ id, version: c.version }));
  fs.writeFileSync(path.join(dir, id, 'data', 'main.js'), c.code);
}

// 跑一次 main，收下它打印的行
function run(t: TestContext, argv: string[], dir: string, record: string): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  t.mock.method(console, 'log', (line: string) => { out.push(line); });
  t.mock.method(console, 'error', (line: string) => { err.push(line); });
  const code = main(argv, dir, record, '1.0.0');
  t.mock.restoreAll();
  return { code, out, err };
}

test('文件夹的 sha256：内容、文件名、多一个文件都会变；和读的顺序无关', t => {
  const { dir } = built(t, { 'a.one': { version: '1.0.0', code: 'x' }, 'a.two': { version: '1.0.0', code: 'x' } });
  const one = hashDir(path.join(dir, 'a.one'));
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.notEqual(one, hashDir(path.join(dir, 'a.two')));   // 清单里的 id 不同
  fs.writeFileSync(path.join(dir, 'a.one', 'data', 'main.js'), 'y');
  const changed = hashDir(path.join(dir, 'a.one'));
  assert.notEqual(changed, one);
  fs.renameSync(path.join(dir, 'a.one', 'data', 'main.js'), path.join(dir, 'a.one', 'data', 'main2.js'));
  assert.notEqual(hashDir(path.join(dir, 'a.one')), changed);
  fs.renameSync(path.join(dir, 'a.one', 'data', 'main2.js'), path.join(dir, 'a.one', 'data', 'main.js'));
  assert.equal(hashDir(path.join(dir, 'a.one')), changed);
  fs.writeFileSync(path.join(dir, 'a.one', 'extra.txt'), '');
  assert.notEqual(hashDir(path.join(dir, 'a.one')), changed);
});

test('构建目录里的组件：带清单的文件夹各一项，别的文件不算', t => {
  const { dir } = built(t, { 'a.one': { version: '1.2.0', code: 'x' }, 'a.two': { version: '2.0.0', code: 'y' } });
  fs.mkdirSync(path.join(dir, 'not-a-component'));
  const now = stamps(dir);
  assert.deepEqual(Object.keys(now), ['a.one', 'a.two']);
  assert.deepEqual([now['a.one']?.version, now['a.two']?.version], ['1.2.0', '2.0.0']);
  assert.equal(now['a.one']?.hash, hashDir(path.join(dir, 'a.one')));
});

test('和发布记录比：内容变了版本没升、版本变低是问题；升了版本、没变、加进来的、拿掉的不是', () => {
  const released: Released = {
    app: '1.0.0',
    components: {
      'a.same': { version: '1.0.0', hash: 'h1' },
      'a.bumped': { version: '1.0.0', hash: 'h2' },
      'a.stale': { version: '1.0.0', hash: 'h3' },
      'a.lower': { version: '1.2.0', hash: 'h4' },
      'a.gone': { version: '1.0.0', hash: 'h5' },
      'a.only-version': { version: '1.0.0', hash: 'h6' },
    },
  };
  const { problems, notes } = compare(released, {
    'a.same': { version: '1.0.0', hash: 'h1' },
    'a.bumped': { version: '1.0.1', hash: 'h2-new' },
    'a.stale': { version: '1.0.0', hash: 'h3-new' },
    'a.lower': { version: '1.1.0', hash: 'h4' },
    'a.only-version': { version: '1.1.0', hash: 'h6' },
    'a.new': { version: '1.0.0', hash: 'h7' },
  });
  assert.equal(problems.length, 2);
  assert.match(problems[0] ?? '', /^a\.stale 的内容变了，版本号还是 1\.0\.0/);
  assert.match(problems[1] ?? '', /^a\.lower 的版本号 1\.1\.0 比 1\.0\.0 发布时的 1\.2\.0 低/);
  assert.equal(notes.length, 2);
  assert.match(notes[0] ?? '', /^a\.gone 不在预装列表里了/);
  assert.match(notes[1] ?? '', /^a\.new 是 1\.0\.0 之后加进预装列表的/);
});

test('没有发布记录时通过；--record 记下之后，改了内容没升版本号退出码 1，升了就通过', t => {
  const { dir, record } = built(t, { 'a.one': { version: '1.0.0', code: 'x' }, 'a.two': { version: '1.0.0', code: 'y' } });
  assert.equal(readRecord(record), null);
  let r = run(t, [], dir, record);
  assert.deepEqual([r.code, r.err], [0, []]);
  assert.match(r.out.join('\n'), /还没有发布记录/);

  r = run(t, ['--record'], dir, record);
  assert.equal(r.code, 0);
  assert.deepEqual(readRecord(record), { app: '1.0.0', components: stamps(dir) });
  assert.equal(run(t, [], dir, record).code, 0);

  write(dir, 'a.one', { version: '1.0.0', code: 'x, changed' });
  r = run(t, [], dir, record);
  assert.equal(r.code, 1);
  assert.equal(r.err.length, 1);
  assert.match(r.err[0] ?? '', /^a\.one 的内容变了/);

  write(dir, 'a.one', { version: '1.0.1', code: 'x, changed' });
  r = run(t, [], dir, record);
  assert.deepEqual([r.code, r.err], [0, []]);
});

test('没有构建目录、记录的格式不对、参数不认识时不通过', t => {
  const { dir, record } = built(t, { 'a.one': { version: '1.0.0', code: 'x' } });
  assert.equal(run(t, [], path.join(dir, 'missing'), record).code, 1);
  assert.equal(run(t, ['--fast'], dir, record).code, 2);
  fs.writeFileSync(record, JSON.stringify({ app: '1.0.0', components: { 'a.one': { version: 1 } } }));
  assert.throws(() => readRecord(record), /a\.one/);
  assert.equal(run(t, [], dir, record).code, 1);
});

test('npm run pack 在打安装包之前跑这个检查', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts['pack'], 'npm run build && node scripts/preinstalled-check.ts && electron-builder --win --x64 --publish never');
  assert.equal(pkg.scripts['check:preinstalled'], 'node scripts/preinstalled-check.ts');
});
