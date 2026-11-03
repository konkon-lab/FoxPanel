import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';

// 代替 electron 的 protocol 和 net：记下登记的处理函数，fetch 读本地文件
type Handler = (req: { url: string }) => Promise<Response>;
const fake = {
  handlers: new Map<string, Handler>(),
  fetched: [] as string[],
};
const KEY = Symbol.for('foxpanel.test.fox-url');
Object.assign(globalThis, {
  [KEY]: {
    protocol: {
      registerSchemesAsPrivileged: () => undefined,
      handle: (scheme: string, fn: Handler) => { fake.handlers.set(scheme, fn); },
    },
    net: {
      fetch: (url: string) => {
        fake.fetched.push(url);
        try {
          return Promise.resolve(new Response(fs.readFileSync(new URL(url)), { status: 200, headers: { 'Content-Type': 'text/plain' } }));
        } catch {
          return Promise.resolve(new Response('', { status: 404 }));
        }
      },
    },
  },
});
const STUB = `data:text/javascript,${encodeURIComponent("const e = globalThis[Symbol.for('foxpanel.test.fox-url')];\nexport const protocol = e.protocol;\nexport const net = e.net;")}`;
registerHooks({
  resolve: (specifier, context, nextResolve) => (specifier === 'electron' ? { url: STUB, shortCircuit: true } : nextResolve(specifier, context)),
});

// protocol.ts 导入 electron：在假模块装好之后加载
const { COMPONENT_CSP, handleScheme, resolveFox } = await import('../src/main/components/protocol.ts');
const { insideDir } = await import('../src/main/components/store.ts');

test('地址解析：fox://host 是页面宿主的文件，路径不带开头的斜杠、解了码，? 和 # 后面的不看', () => {
  assert.deepEqual(resolveFox('fox://host/media.html'), { kind: 'host', rel: 'media.html' });
  assert.deepEqual(resolveFox('fox://host/window/index.html#/logs'), { kind: 'host', rel: 'window/index.html' });
  assert.deepEqual(resolveFox('fox://host/lib/vue.js?v=1'), { kind: 'host', rel: 'lib/vue.js' });
  assert.deepEqual(resolveFox('fox://host/a%20b/%E4%B8%AD.js'), { kind: 'host', rel: 'a b/中.js' });
  assert.deepEqual(resolveFox('fox://host//x.js'), { kind: 'host', rel: 'x.js' });
  assert.deepEqual(resolveFox('fox://host/'), { kind: 'host', rel: '' });
  assert.deepEqual(resolveFox('fox://host'), { kind: 'host', rel: '' });
});

test('地址解析：主机名是「面板 id.panel」的也是页面宿主的文件，每块面板一个主机名(一个源)', () => {
  assert.deepEqual(resolveFox('fox://yanuo.shell-classic.panel/panel.html'), { kind: 'host', rel: 'panel.html' });
  assert.deepEqual(resolveFox('fox://me.clock.panel/lib/cordis.js'), { kind: 'host', rel: 'lib/cordis.js' });
  assert.deepEqual(resolveFox('fox://a-1.b-2.panel/assets/panel-abc.js?x#y'), { kind: 'host', rel: 'assets/panel-abc.js' });
  // 两块面板的地址是不同的源，也都不是主窗口的源
  const origins = ['fox://me.clock.panel/panel.html', 'fox://me.notes.panel/panel.html', 'fox://host/window/index.html'].map(u => new URL(u).host);
  assert.equal(new Set(origins).size, 3);
  // .panel 前面要是合格的组件 id
  for (const host of ['panel', '.panel', 'clock.panel', 'a.b.c.panel', 'A.b.panel', 'a_b.c.panel', 'a.b.panels', 'a.b.panel.evil', 'host.panel', 'component.panel']) {
    assert.equal(resolveFox(`fox://${host}/panel.html`), null, host);
  }
});

test('地址解析：fox://component/<id>/<路径> 是组件包里的文件；没有路径、别的主机名、别的协议、解不了码的都不认', () => {
  assert.deepEqual(resolveFox('fox://component/yanuo.keys/page.js'), { kind: 'component', id: 'yanuo.keys', rel: 'page.js' });
  assert.deepEqual(resolveFox('fox://component/yanuo.keys/dist/a%20b.js?t=17'), { kind: 'component', id: 'yanuo.keys', rel: 'dist/a b.js' });
  assert.deepEqual(resolveFox('fox://component/yanuo.keys/'), { kind: 'component', id: 'yanuo.keys', rel: '' });
  for (const bad of [
    'fox://component/yanuo.keys', 'fox://component/', 'fox://component', 'fox://other/x.js', 'fox://host:8080/x.js', 'fox://user@host/x.js',
    'https://host/media.html', 'file:///C:/x.js', 'fox://host/%E0%A4%A', 'not a url', '',
  ]) assert.equal(resolveFox(bad), null, bad);
});

test('地址解析：路径里往上走的段解析之后也出不了目录', () => {
  const root = path.join(os.tmpdir(), 'foxpanel-fox-url-root');
  const inside = (address: string): string | null => {
    const target = resolveFox(address);
    return target ? insideDir(root, target.rel) : null;
  };
  assert.equal(inside('fox://host/panel.html'), path.join(root, 'panel.html'));
  assert.equal(inside('fox://me.clock.panel/lib/vue.js'), path.join(root, 'lib', 'vue.js'));
  for (const address of [
    'fox://host/../secret.txt', 'fox://host/lib/../../secret.txt', 'fox://host/%2e%2e/secret.txt', 'fox://host/..%2Fsecret.txt', 'fox://host/..%5Csecret.txt',
    'fox://me.clock.panel/%2E%2E%2F%2E%2E%2Fsecret.txt', 'fox://me.clock.panel/lib/..%2F..%2Fsecret.txt',
  ]) {
    const file = inside(address);
    assert.ok(file === null || file.startsWith(root + path.sep), address);
    assert.ok(!(file ?? '').endsWith('secret.txt') || file === path.join(root, 'secret.txt'), address);
  }
  assert.equal(inside('fox://host/..%2Fsecret.txt'), null);
  assert.equal(inside('fox://host/..%5Csecret.txt'), null);
});

test('处理请求：页面宿主和面板的主机名读同一个目录，组件文件交给调用方对到文件；响应带 CORS 头、不缓存，找不到回 404', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-fox-url-'));
  try {
    const hostRoot = path.join(dir, 'host');
    const comp = path.join(dir, 'comp');
    fs.mkdirSync(hostRoot);
    fs.mkdirSync(comp);
    fs.writeFileSync(path.join(hostRoot, 'panel.html'), 'PANEL');
    fs.writeFileSync(path.join(comp, 'page.js'), 'PAGE');
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'SECRET');
    const asked: [string, string][] = [];
    handleScheme(hostRoot, (id, rel) => {
      asked.push([id, rel]);
      return id === 'a.b' ? insideDir(comp, rel) : null;
    });
    const handler = fake.handlers.get('fox');
    assert.ok(handler);
    const get = async (url: string): Promise<[number, string]> => {
      const res = await handler({ url });
      return [res.status, await res.text()];
    };
    assert.deepEqual(await get('fox://host/panel.html'), [200, 'PANEL']);
    assert.deepEqual(await get('fox://me.clock.panel/panel.html'), [200, 'PANEL']);
    assert.deepEqual(await get('fox://me.notes.panel/panel.html?x=1'), [200, 'PANEL']);
    assert.deepEqual(await get('fox://component/a.b/page.js?t=5'), [200, 'PAGE']);
    assert.deepEqual(asked, [['a.b', 'page.js']]);
    const ok = await handler({ url: 'fox://me.clock.panel/panel.html' });
    assert.deepEqual([ok.headers.get('Access-Control-Allow-Origin'), ok.headers.get('Cache-Control')], ['*', 'no-store']);
    // 组件文件的响应带内容安全策略(被当成文档或 worker 加载时不能联网、不能再嵌框架)；页面宿主的文件不带(它们的策略写在页面里)
    const part = await handler({ url: 'fox://component/a.b/page.js' });
    assert.deepEqual([part.headers.get('Content-Security-Policy'), part.headers.get('Access-Control-Allow-Origin')], [COMPONENT_CSP, '*']);
    assert.equal(ok.headers.get('Content-Security-Policy'), null);
    assert.equal((await handler({ url: 'fox://host/panel.html' })).headers.get('Content-Security-Policy'), null);
    assert.match(COMPONENT_CSP, /^default-src fox:;/);
    for (const rule of ["frame-src 'none'", "child-src 'none'", "worker-src 'none'", "object-src 'none'"]) assert.ok(COMPONENT_CSP.includes(rule), rule);
    assert.doesNotMatch(COMPONENT_CSP, /https?:|\*|unsafe/);
    // 找不到的文件、出了目录的路径、不认识的主机名、别的组件
    const before = fake.fetched.length;
    for (const url of ['fox://host/..%2Fsecret.txt', 'fox://me.clock.panel/..%2Fsecret.txt', 'fox://clock.panel/panel.html', 'fox://component/a.c/page.js', 'fox://component/a.b/..%2F..%2Fsecret.txt', 'fox://elsewhere/panel.html']) {
      assert.deepEqual(await get(url), [404, 'not found'], url);
    }
    assert.equal(fake.fetched.length, before);
    assert.deepEqual(await get('fox://host/missing.html'), [404, 'not found']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
