import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 用仓库里的源码查：键盘的约定(状态、设置、语言包、操作、能调的方法)只在 sdk/keyboard.ts，是输入法组件的服务约定；
// 核心的源码(src/ 下)不引用它，组件经 @konkon-lab/foxpanel-sdk 拿得到全部。

const ROOT = path.resolve(import.meta.dirname, '..');
const KEYBOARD_SDK = path.join(ROOT, 'sdk', 'keyboard.ts');

// 目录下的全部 .ts 和 .vue
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) return sources(file);
    return /\.(ts|vue)$/.test(e.name) ? [file] : [];
  });
}

// sdk/keyboard.ts 导出的类型名
const names = [...fs.readFileSync(KEYBOARD_SDK, 'utf8').matchAll(/^export (?:type|interface) (\w+)/gm)].flatMap(m => (m[1] ? [m[1]] : []));

test('键盘的约定：sdk/keyboard.ts 导出状态、设置、语言包、操作、能调的方法和页面的 kb 服务', () => {
  for (const name of ['KeyboardState', 'KeyboardSettings', 'KeyboardAction', 'KeyboardCalls', 'KeyCode', 'ImeDef', 'ImePack', 'PackMode', 'CandidateItem', 'KbService', 'KbEvents']) {
    assert.ok(names.includes(name), name);
  }
});

test('键盘的约定：核心的源码不引用 sdk/keyboard.ts，也不出现它导出的类型名', () => {
  const files = sources(path.join(ROOT, 'src'));
  assert.ok(files.length > 40);
  const word = new RegExp(`\\b(?:${names.join('|')})\\b`);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    assert.ok(!/sdk\/keyboard(?:\.ts)?['"]/.test(text), `${rel} 导入了 sdk/keyboard.ts`);
    assert.equal(word.exec(text)?.[0], undefined, `${rel} 里出现了键盘的类型名`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'shared', 'keyboard.ts')));
});

test('键盘的约定：@konkon-lab/foxpanel-sdk 把 sdk/keyboard.ts 导出的类型都带出来', () => {
  const index = fs.readFileSync(path.join(ROOT, 'sdk', 'index.ts'), 'utf8');
  const block = /export type \{([^}]+)\} from '\.\/keyboard\.ts';/.exec(index)?.[1] ?? assert.fail('sdk/index.ts 没有从 keyboard.ts 再导出');
  const exported = block.split(',').map(s => s.trim()).filter(Boolean).sort();
  assert.deepEqual(exported, [...names].sort());
});

test('面板页面宿主：不读远程服务 keyboard、不认键盘的状态，没有部署提示和缺件提示的文字；没有 src/keyboard 这个目录', () => {
  const dir = path.join(ROOT, 'src', 'panel');
  const files = fs.readdirSync(dir);
  assert.deepEqual([...files].sort(), ['click.ts', 'drag-scroll.ts', 'main.ts', 'media.html', 'media.ts', 'panel.html', 'parts.ts', 'relay.ts', 'services.ts', 'style.css']);
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'keyboard')));
  for (const name of files) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.doesNotMatch(text, /'keyboard'|\.ready\b|darkMode|deploying|uiLang|\.kb\b|kb-theme|sidebuttons/, name);
    // 宿主没有按界面语言分的文案表
    assert.doesNotMatch(text, /'zh-Hant'\s*:|\bja\s*:\s*[{'"]/, name);
  }
  const host = fs.readFileSync(path.join(dir, 'main.ts'), 'utf8');
  // 页面是哪块面板、加载什么都来自宿主给的计划；深色和界面语言来自宿主给的外观
  assert.match(host, /const plan = await fox\.plan\(\);/);
  assert.match(host, /Object\.assign\(look, await fox\.look\(\)\);/);
  assert.match(host, /el\.classList\.toggle\('dark', look\.dark\);/);
  // 根元素和弹层的类名
  const html = fs.readFileSync(path.join(dir, 'panel.html'), 'utf8');
  assert.match(html, /<div id="root" class="fox-panel fox-theme"><\/div>\s*<div id="overlay" class="fox-theme"><\/div>/);
});

test('面板宿主页和媒体页面的内容安全策略：只放行自己和 fox://，没有外站；不能嵌框架、不能开 worker、不能嵌插件', () => {
  for (const name of ['panel.html', 'media.html']) {
    const html = fs.readFileSync(path.join(ROOT, 'src', 'panel', name), 'utf8');
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1] ?? assert.fail(`${name} 没有内容安全策略`);
    const rules = new Map(csp.split(';').map(r => r.trim().split(/\s+/)).map(([k = '', ...v]) => [k, v.join(' ')]));
    assert.equal(rules.get('default-src'), "'self' fox:", name);
    for (const k of ['frame-src', 'child-src', 'worker-src', 'object-src']) assert.equal(rules.get(k), "'none'", `${name} ${k}`);
    assert.doesNotMatch(csp, /https?:|wss?:|\*/, name);
    // 能联网的指令要么没写(落到 default-src)，要么只有自己和 fox://
    assert.ok(['', "'self' fox:"].includes(rules.get('connect-src') ?? ''), name);
  }
});

test('公共样式：弹层里自己写了 lang 的元素按输入语言选字体(四种语言都有)；根元素里的只有日文、韩文另选', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src', 'panel', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const fontOf = (selector: string): string => {
    const at = css.split('}').find(block => block.split('{')[0]?.split(',').some(s => s.trim() === selector));
    return /font-family:\s*([^;]+);/.exec(at ?? '')?.[1] ?? '';
  };
  assert.match(fontOf("#overlay [lang='zh-Hans']"), /^'Noto Sans SC', 'Microsoft YaHei UI'/);
  assert.match(fontOf("#overlay [lang='zh-Hant']"), /^'Noto Sans TC', 'Microsoft JhengHei UI'/);
  assert.match(fontOf("#overlay [lang='ja']"), /^'Noto Sans JP'/);
  assert.match(fontOf("#overlay [lang='ko']"), /^'Noto Sans KR'/);
  // 主题根上按界面语言选的字体和弹层里按输入语言选的是同一套
  assert.equal(fontOf("#overlay [lang='zh-Hans']"), fontOf('.fox-theme'));
  assert.equal(fontOf("#overlay [lang='zh-Hant']"), fontOf(".fox-theme[lang='zh-Hant']"));
  assert.equal(fontOf("#overlay [lang='ja']"), fontOf(".fox-theme[lang='ja']"));
  assert.equal(fontOf("#overlay [lang='ko']"), fontOf(".fox-theme[lang='ko']"));
  // 根元素里的后代：中文两种不另选(键帽的字体跟界面语言)
  assert.equal(fontOf(".fox-panel [lang='zh-Hans']"), '');
  assert.equal(fontOf(".fox-panel [lang='zh-Hant']"), '');
  assert.notEqual(fontOf(".fox-panel [lang='ja']"), '');
});
