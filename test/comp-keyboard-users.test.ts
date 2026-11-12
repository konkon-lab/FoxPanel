import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseManifest, type Manifest } from '../src/shared/manifest.ts';

// 用仓库里预装组件和示例组件的源码查：主进程部分(main 入口和它引用的文件)要键盘的状态和操作时走远程服务 keyboard，
// 清单里写了它；组件进程里没有 kb 服务(那是页面里的)，上下文上也没有 keyboard，谁都不碰。

const ROOT = path.resolve(import.meta.dirname, '..');
const IME = 'yanuo.ime';

// 上下文上的 kb(ctx.kb、inject 里的 'kb')和 keyboard(ctx.keyboard)
const ROOT_KEYBOARD = /\.kb\b|\.keyboard\b|'kb'/;
// 用远程服务 keyboard
const REMOTE_KEYBOARD = /\.use\(\s*'keyboard'\s*\)/;
// 提供远程服务 keyboard
const SERVES_KEYBOARD = /\.serve\(\s*'keyboard'\s*[,)]/;
// 相对路径的导入
const IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;

function manifestIn(dir: string): Manifest {
  const r = parseManifest(JSON.parse(fs.readFileSync(path.join(dir, 'component.json'), 'utf8')));
  if (!r.ok) assert.fail(`${dir}：${r.errors.join('；')}`);
  return r.manifest;
}

// 带清单的组件文件夹：components/ 和 examples/ 下面的
const folders = ['components', 'examples'].flatMap(group => fs.readdirSync(path.join(ROOT, group), { withFileTypes: true })
  .filter(e => e.isDirectory() && fs.existsSync(path.join(ROOT, group, e.name, 'component.json')))
  .map(e => path.join(ROOT, group, e.name)));

// 主进程入口的源码：预装组件是 src/main.ts，示例是清单 main 写的文件；没有主进程部分时为 null
function mainEntry(dir: string, m: Manifest): string | null {
  if (!m.main) return null;
  const src = path.join(dir, 'src', 'main.ts');
  return fs.existsSync(src) ? src : path.join(dir, m.main);
}

// entry 和它经相对路径导入的全部文件
function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file) || !fs.existsSync(file)) return;
    seen.add(file);
    for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) if (spec) visit(path.resolve(path.dirname(file), spec));
  };
  visit(entry);
  return [...seen];
}

test('主进程组件：都不用上下文上的 kb 和 keyboard；用远程服务 keyboard 的在清单里写了它，提供它的只有输入法', () => {
  const remote: string[] = [];
  const serving: string[] = [];
  let checked = 0;
  for (const dir of folders) {
    const m = manifestIn(dir);
    const entry = mainEntry(dir, m);
    if (!entry) continue;
    checked++;
    const files = reachable(entry);
    assert.ok(files.length > 0, m.id);
    const texts = files.map(f => fs.readFileSync(f, 'utf8'));
    files.forEach((file, i) => assert.ok(!ROOT_KEYBOARD.test(texts[i] ?? ''), `${m.id} 的 ${path.relative(ROOT, file)} 用了上下文上的 kb 或 keyboard`));
    if (texts.some(text => SERVES_KEYBOARD.test(text))) {
      serving.push(m.id);
      assert.ok(m.provides?.includes('keyboard'), `${m.id} 提供远程服务 keyboard，清单的 provides 里没有它`);
    }
    if (!texts.some(text => REMOTE_KEYBOARD.test(text))) continue;
    remote.push(m.id);
    assert.ok(m.requires?.includes('keyboard') || m.uses?.includes('keyboard'), `${m.id} 用了远程服务 keyboard，清单的 requires 和 uses 里都没有它`);
  }
  assert.ok(checked >= 9);
  assert.deepEqual(remote.sort(), ['yanuo.asr-bailian']);
  assert.deepEqual(serving, [IME]);
});

test('主进程组件：听写没有输入法也能工作，清单写的是 uses，不是 requires；SteamVR 组件不用 keyboard，清单里两样都不写', () => {
  const asr = manifestIn(path.join(ROOT, 'components', 'asr-bailian'));
  assert.deepEqual(asr.uses, ['keyboard']);
  assert.ok(!asr.requires?.includes('keyboard'));
  const vr = manifestIn(path.join(ROOT, 'components', 'steamvr'));
  assert.deepEqual([vr.uses, vr.requires, vr.provides], [undefined, undefined, ['panels']]);
});
