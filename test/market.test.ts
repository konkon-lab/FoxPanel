import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KEYWORD, PACKAGE_NAME, parseSummary, SDK_PACKAGE } from '../src/shared/market.ts';
import { parseManifest } from '../src/shared/manifest.ts';
import { isObject } from '../src/shared/util.ts';
import { packageOf } from '../scripts/pack-component.ts';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Yarn, type YarnFork } from '../src/main/components/yarn.ts';
import { readMarket } from '../src/main/components/settings.ts';
import { Market } from '../src/main/components/market.ts';

test('组件包名：foxpanel-component- 开头，可以带作用域', () => {
  assert.ok(PACKAGE_NAME.test('foxpanel-component-hello'));
  assert.ok(PACKAGE_NAME.test('@yanuo/foxpanel-component-hello'));
  assert.ok(!PACKAGE_NAME.test('hello'));
  assert.ok(!PACKAGE_NAME.test('foxpanel-component-'));
  assert.ok(!PACKAGE_NAME.test('../foxpanel-component-x'));
});

test('foxpanel 字段：id、类别、名字必填，带代码默认否，多余的丢掉', () => {
  assert.deepEqual(parseSummary({ id: 'a.b', kind: 'sidepage', name: { 'zh-Hans': '你好' }, provides: 'x', extra: 1 }),
    { id: 'a.b', kind: 'sidepage', name: { 'zh-Hans': '你好' }, code: false });
  assert.equal(parseSummary({ id: 'ab', kind: 'sidepage', name: 'x' }), null);
  assert.equal(parseSummary({ id: 'a.b', kind: 'nope', name: 'x' }), null);
  assert.equal(parseSummary(null), null);
});

test('市场设置：仓库只认 http(s)，安装脚本默认关', () => {
  assert.deepEqual(readMarket(undefined), { registry: 'https://registry.npmmirror.com', scripts: false });
  assert.deepEqual(readMarket({ registry: 'file:///c:/x', scripts: true }), { registry: 'https://registry.npmmirror.com', scripts: true });
  assert.equal(readMarket({ registry: 'https://registry.npmjs.org' }).registry, 'https://registry.npmjs.org');
});

// 假的 yarn：add 往 package.json 写依赖，fail 改了文件再失败
const FAKE = `
const fs = require('fs');
const [cmd, arg] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (cmd === 'add') { const [n, v] = arg.split('@'); pkg.dependencies[n] = v; fs.writeFileSync('package.json', JSON.stringify(pkg)); console.log('YN0000: done'); }
if (cmd === 'fail') { pkg.dependencies.broken = '1'; fs.writeFileSync('package.json', JSON.stringify(pkg)); fs.writeFileSync('yarn.lock', 'x'); console.log('YN0001: │ Error: boom'); process.exit(1); }
`;

test('yarn：写项目文件，排队跑，失败时 package.json 和 yarn.lock 回到跑之前', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-yarn-'));
  const dir = path.join(root, 'components');
  const yarnFile = path.join(root, 'yarn.cjs');
  fs.writeFileSync(yarnFile, FAKE);
  const logs: string[] = [];
  // 测试里用 node 子进程代替程序里的 utilityProcess
  const fork: YarnFork = (script, args, o) => spawn(process.execPath, [script, ...args], { cwd: o.cwd, env: o.env, windowsHide: true });
  const yarn = new Yarn({ dir, yarn: yarnFile, fork, registry: () => 'https://example.com', scripts: () => false, log: t => logs.push(t) });
  yarn.prepare();
  assert.match(fs.readFileSync(path.join(dir, '.yarnrc.yml'), 'utf8'), /enableScripts: false[\s\S]*npmRegistryServer: "https:\/\/example.com"/);
  await Promise.all([yarn.run(['add', 'foxpanel-component-a@1.0.0']), yarn.run(['add', 'foxpanel-component-b@2.0.0'])]);
  assert.deepEqual(yarn.dependencies(), { 'foxpanel-component-a': '1.0.0', 'foxpanel-component-b': '2.0.0' });
  await assert.rejects(yarn.run(['fail']), /boom/);
  assert.deepEqual(yarn.dependencies(), { 'foxpanel-component-a': '1.0.0', 'foxpanel-component-b': '2.0.0' });
  assert.equal(fs.readFileSync(path.join(dir, 'yarn.lock'), 'utf8'), '');
  assert.ok(logs.some(l => l.includes('YN0000: done')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('yarn：跑满 10 分钟被停掉时报超时，package.json 回到跑之前', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-yarn-'));
  const dir = path.join(root, 'components');
  let killed = false;
  // 不会自己退出的假进程：改了 package.json 后一直挂着，被 kill 时才退出(退出码 null)
  const fork: YarnFork = (_script, _args, o) => {
    const p = new EventEmitter();
    fs.writeFileSync(path.join(o.cwd, 'package.json'), JSON.stringify({ dependencies: { half: '1' } }));
    return {
      stdout: null, stderr: null, once: (event, fn) => p.once(event, fn),
      kill: () => {
        killed = true;
        queueMicrotask(() => p.emit('exit', null));
        return true;
      },
    };
  };
  const yarn = new Yarn({ dir, yarn: 'yarn.cjs', fork, registry: () => 'https://example.com', scripts: () => false, log: () => undefined });
  const run = yarn.run(['add', 'foxpanel-component-a@1.0.0']);
  const failed = assert.rejects(run, /超过 10 分钟/);
  // 排队的任务在微任务里才起进程
  await new Promise(r => setImmediate(r));
  assert.deepEqual(yarn.dependencies(), { half: '1' });
  t.mock.timers.tick(10 * 60_000 - 1);
  assert.equal(killed, false);
  t.mock.timers.tick(1);
  await failed;
  assert.equal(killed, true);
  assert.deepEqual(yarn.dependencies(), {});
  fs.rmSync(root, { recursive: true, force: true });
});

test('市场：发布不满一天的版本不列，默认取能装的最新版；指定新版本时给出能装的时间', async t => {
  const now = Date.now();
  const doc = {
    name: 'foxpanel-component-a', 'dist-tags': { latest: '1.1.0' },
    time: { '1.0.0': new Date(now - 3 * 86_400_000).toISOString(), '1.1.0': new Date(now - 3_600_000).toISOString() },
    versions: Object.fromEntries(['1.0.0', '1.1.0'].map(v => [v, { version: v, license: 'MIT', foxpanel: { id: 'a.b', kind: 'skin', name: 'A' }, peerDependencies: { '@konkon-lab/foxpanel-sdk': '^0.1.0' } }])),
  };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(doc)));
  const market = new Market(() => 'https://example.com', '0.1.5');
  const a = await market.info('foxpanel-component-a');
  assert.deepEqual([a.version, a.versions, a.readyAt, a.compatible], ['1.0.0', ['1.0.0'], undefined, true]);
  const b = await market.info('foxpanel-component-a', '1.1.0');
  assert.equal(b.readyAt, new Date(Date.parse(doc.time['1.1.0']) + 86_400_000).toISOString());
  assert.equal((await new Market(() => 'https://example.com', '0.2.0').info('foxpanel-component-a')).compatible, false);
});

test('市场：按关键词搜索，只列包名合规则、最新版带 foxpanel 字段的包', async t => {
  const answers: Record<string, unknown> = {
    '/-/v1/search': { objects: [
      { package: { name: 'foxpanel-component-a', version: '1.0.0', description: 'A', publisher: { username: 'yanuo' } }, downloads: { monthly: 5 } },
      { package: { name: 'foxpanel-component-b', version: '1.0.0' } },
      { package: { name: 'other-package', version: '1.0.0' } },
    ] },
    '/foxpanel-component-a/1.0.0': { foxpanel: { id: 'a.b', kind: 'skin', name: 'A' } },
    '/foxpanel-component-b/1.0.0': { component: { id: 'a.c', kind: 'skin', name: 'B' } },
  };
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const url = new URL(input);
    urls.push(url);
    return new Response(JSON.stringify(answers[url.pathname] ?? {}));
  });
  const items = await new Market(() => 'https://example.com', '0.1.5').search();
  assert.equal(urls[0]?.pathname, '/-/v1/search');
  assert.equal(urls[0]?.searchParams.get('text'), `keywords:${KEYWORD}`);
  assert.ok(urls[0]?.search.includes('keywords%3Afoxpanel-component'));
  assert.deepEqual(urls.slice(1).map(u => u.pathname).sort(), ['/foxpanel-component-a/1.0.0', '/foxpanel-component-b/1.0.0']);
  assert.deepEqual(items.map(i => [i.name, i.publisher, i.downloads, i.component]),
    [['foxpanel-component-a', 'yanuo', 5, { id: 'a.b', kind: 'skin', name: 'A', code: false }]]);
});

test('打包：生成的 package.json 带包名、关键词、SDK 范围和 foxpanel 字段，市场读得出来', async t => {
  const r = parseManifest({ id: 'yanuo.skin-warm', kind: 'skin', name: { 'zh-Hans': '暖色', en: 'Warm' }, version: '1.2.0', author: 'yanuo', license: 'MIT', skin: 'skin.css' });
  assert.ok(r.ok);
  const files = ['component.json', 'skin.css'];
  const pkg = packageOf({}, r.manifest, files, false, '0.1.5');
  assert.equal(pkg.name, 'foxpanel-component-yanuo-skin-warm');
  assert.ok(PACKAGE_NAME.test(pkg.name));
  assert.deepEqual([pkg['version'], pkg['type'], pkg['description'], pkg['files']], ['1.2.0', 'module', '暖色', files]);
  assert.deepEqual(pkg['keywords'], [KEYWORD]);
  assert.deepEqual(pkg['peerDependencies'], { [SDK_PACKAGE]: '^0.1.5' });
  assert.deepEqual(parseSummary(pkg['foxpanel']), { id: 'yanuo.skin-warm', kind: 'skin', name: { 'zh-Hans': '暖色', en: 'Warm' }, code: false });

  // 作者自己的 package.json 为底：包名、关键词、依赖留着，private、devDependencies、scripts 不进包
  const own = { name: '@yanuo/foxpanel-component-warm', private: true, keywords: ['skin', KEYWORD], peerDependencies: { vue: '^3.5.0' }, devDependencies: { vite: '^7.0.0' }, scripts: { build: 'vite build' } };
  const scoped = packageOf(own, r.manifest, files, true, '0.1.5');
  assert.equal(scoped.name, '@yanuo/foxpanel-component-warm');
  assert.deepEqual(scoped['keywords'], [KEYWORD, 'skin']);
  assert.deepEqual(scoped['peerDependencies'], { vue: '^3.5.0', [SDK_PACKAGE]: '^0.1.5' });
  assert.ok(isObject(scoped['foxpanel']) && scoped['foxpanel']['code'] === true);
  for (const k of ['private', 'devDependencies', 'scripts']) assert.ok(!(k in scoped), k);
  assert.throws(() => packageOf({ name: 'warm-skin' }, r.manifest, files, false, '0.1.5'), /foxpanel-component-<名字>/);

  // 生成的 package.json 当仓库的答复，市场认它是能装的组件
  const doc = { name: pkg.name, 'dist-tags': { latest: '1.2.0' }, time: { '1.2.0': new Date(Date.now() - 3 * 86_400_000).toISOString() }, versions: { '1.2.0': pkg } };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(doc)));
  const info = await new Market(() => 'https://example.com', '0.1.5').info(pkg.name);
  assert.deepEqual([info.version, info.component?.id, info.sdk, info.compatible], ['1.2.0', 'yanuo.skin-warm', '^0.1.5', true]);
});
