// 构建到 dist/：
// 主进程、组件进程(ESM)、yarn-host 和两个 preload(CJS，沙箱仅支持 CJS；preload.cjs 给主窗口，preload-page.cjs 给面板页面和媒体页面)用 esbuild；主窗口(Vue)用 Vite；
// 面板宿主页和媒体页面(src/panel) → dist/host，主窗口 → dist/host/window；共享库(src/shared/libs.ts)不打进去，由 import map 指向 dist/host/lib；
// 预装组件 components/<名字> → dist/components/<id>/：src/page.ts 打成 page.js、src/panel.ts 打成 panel.js、src/window.ts 打成 window.js(Vite 库模式，样式由脚本注入)，
// src/main.ts 打成 main.js、src/worker.ts 打成 worker.js(esbuild，Node ESM)，其余文件原样复制；
// 开发用的组件 dev/<名字> → dist/dev/<名字>/，打法和预装组件一样(不进预装列表，安装包不带)；
// 程序图标由 resources/icon.svg 渲染到 dist/icons(scripts/icons.ts，icon-gen)；
// 打进产物的 npm 包的许可证全文收成 dist/THIRD_PARTY_LICENSES.txt(scripts/licenses.ts)。
// 各部分写的目录互不相交，同时进行；import map 和许可证等全部打完后写。

import { build, type BuildOptions } from 'esbuild';
import { build as viteBuild, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LIB_DIR, PANEL_LIBS, WINDOW_LIBS, type LibName } from '../src/shared/libs.ts';
import { WINDOW_API_GLOBAL, WINDOW_API_NAMES } from '../src/shared/window-api.ts';
import { buildIcons } from './icons.ts';
import { bundledPackageDirs, licensesText, readPackage, type BundleMeta } from './licenses.ts';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const lib = path.join(dist, LIB_DIR);
const common: BuildOptions = { bundle: true, sourcemap: true, target: 'es2023', logLevel: 'warning' };
const nodeCode: BuildOptions = { ...common, platform: 'node' };
const componentCode: BuildOptions = { ...nodeCode, sourcemap: false, format: 'esm' };   // 组件的主进程代码(Node ESM)
const PANEL_SHARED = Object.keys(PANEL_LIBS);   // 面板页面、媒体页面里留给 import map 的共享库
const WINDOW_SHARED = Object.keys(WINDOW_LIBS);
const HOST_SHARED = ['cordis', 'koffi'];   // 组件进程里指向宿主那份的模块(地址由 src/main/main.ts 的 newHost 给)，不打进组件的 main.js
const COMPONENT_JOBS = 4;                   // 同时打包的预装组件数
const LICENSES_FILE = 'THIRD_PARTY_LICENSES.txt';   // 打进产物的 npm 包的许可证全文，在 dist/ 下
const COPIED_PACKAGES = ['node_modules/vue'];        // 文件原样复制进 dist/ 的包(不经打包，metafile 里没有)

// 进安装包的各个 esbuild 产物的 metafile：收许可证时按它找出打进去的 npm 包
const metas: BundleMeta[] = [];

// esbuild 打包一份进安装包的代码，记下 metafile
async function bundleCode(options: BuildOptions): Promise<void> {
  const result = await build({ ...options, metafile: true });
  metas.push(result.metafile);
}

fs.rmSync(dist, { recursive: true, force: true });

// 库模式产出的 css 由入口脚本插入 <style>
function inlineCss(): Plugin {
  return {
    name: 'inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const css = Object.values(bundle).filter(f => f.type === 'asset' && f.fileName.endsWith('.css'));
      const text = css.map(f => (f.type === 'asset' ? String(f.source) : '')).join('\n');
      for (const f of css) delete bundle[f.fileName];
      if (!text) return;
      for (const f of Object.values(bundle)) {
        if (f.type === 'chunk' && f.isEntry) f.code = `{const s=document.createElement('style');s.textContent=${JSON.stringify(text)};document.head.append(s);}\n${f.code}`;
      }
    },
  };
}

// 对 items 逐个调 run，同时最多 limit 个
async function eachLimit<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await run(items[next++]!);
  };
  await Promise.all(Array.from({ length: limit }, worker));
}

// 组件的页面代码：打成 dest/<name>.js，shared 里的共享库留给 import map
async function buildPageCode(entry: string, dest: string, name: string, shared: string[]): Promise<void> {
  await viteBuild({
    configFile: false,
    logLevel: 'warn',
    plugins: [vue(), inlineCss()],
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      outDir: dest,
      emptyOutDir: false,
      target: 'es2023',
      minify: true,
      lib: { entry, formats: ['es'], fileName: () => `${name}.js` },
      rollupOptions: { external: shared },
    },
  });
}

// 一个组件：src/ 里的各入口各打一个文件，其余文件原样复制(布局、皮肤、语言这些数据组件没有 src/)；shipped = 进安装包的(打进去的 npm 包要收许可证)
async function buildComponent(dir: string, dest: string, shipped: boolean): Promise<void> {
  const bundle = shipped ? bundleCode : build;
  const entry = (name: string): string => path.join(dir, 'src', `${name}.ts`);
  const has = (name: string): boolean => fs.existsSync(entry(name));
  const { kind } = JSON.parse(fs.readFileSync(path.join(dir, 'component.json'), 'utf8')) as { kind?: unknown };
  // 打进 main.js 的 CommonJS 依赖要用 require：ESM 里补一个
  const banner = { js: "import { createRequire as __foxRequire } from 'node:module'; const require = __foxRequire(import.meta.url);" };
  await Promise.all([
    // window 组件的 page 跑在主窗口，其他类别的跑在面板页面或媒体页面
    has('page') && buildPageCode(entry('page'), dest, 'page', kind === 'window' ? WINDOW_SHARED : PANEL_SHARED),
    // 面板的根组件
    has('panel') && buildPageCode(entry('panel'), dest, 'panel', PANEL_SHARED),
    has('window') && buildPageCode(entry('window'), dest, 'window', WINDOW_SHARED),
    has('main') && bundle({ ...componentCode, entryPoints: [entry('main')], outfile: path.join(dest, 'main.js'), external: HOST_SHARED, banner }),
    // 主进程代码用的工作线程
    has('worker') && bundle({ ...componentCode, entryPoints: [entry('worker')], outfile: path.join(dest, 'worker.js'), external: ['koffi'] }),
  ]);
  fs.cpSync(dir, dest, { recursive: true, filter: f => path.relative(dir, f).split(path.sep)[0] !== 'src' });
}

// 预装组件：components/preinstalled.json 里列的每个都打包
async function buildComponents(): Promise<void> {
  const src = path.join(root, 'components');
  const out = path.join(dist, 'components');
  // 预装列表：组件 id 或 { group, ids } 分组
  const list = JSON.parse(fs.readFileSync(path.join(src, 'preinstalled.json'), 'utf8')) as (string | { ids: string[] })[];
  const ids = list.flatMap(x => (typeof x === 'string' ? [x] : x.ids));
  await eachLimit(ids, COMPONENT_JOBS, id => buildComponent(path.join(src, id.split('.')[1] ?? id), path.join(out, id), true));
  fs.copyFileSync(path.join(src, 'preinstalled.json'), path.join(out, 'preinstalled.json'));
}

// 开发用的组件：dev/ 下每个带清单的文件夹都打包
async function buildDevComponents(): Promise<void> {
  const src = path.join(root, 'dev');
  const names = fs.readdirSync(src).filter(name => fs.existsSync(path.join(src, name, 'component.json')));
  await Promise.all(names.map(name => buildComponent(path.join(src, name), path.join(dist, 'dev', name), false)));
}

// 共享库文件：Vue 运行时(浏览器 ESM)原样复制；Cordis、Naive UI、Lucide 图标各自连同依赖打成一个文件；
// @konkon-lab/foxpanel-window 是转接模块，把宿主挂在 globalThis 上的对象转成模块导出
async function buildSharedLibs(): Promise<void> {
  const bundle = (name: string, outfile: string): Promise<void> => bundleCode({
    ...common, sourcemap: false, platform: 'browser', format: 'esm', minify: true, external: ['vue'], define: { 'process.env.NODE_ENV': '"production"' },
    entryPoints: [name], outfile,
  });
  const shim = [`const w = globalThis.${WINDOW_API_GLOBAL};`, ...WINDOW_API_NAMES.map(n => `export const ${n} = w.${n};`)];
  const make: Record<LibName, (outfile: string) => unknown> = {
    vue: outfile => fs.copyFileSync(path.join(root, 'node_modules', 'vue', 'dist', 'vue.runtime.esm-browser.prod.js'), outfile),
    'naive-ui': outfile => bundle('naive-ui', outfile),
    '@lucide/vue': outfile => bundle('@lucide/vue', outfile),
    cordis: outfile => bundle('cordis', outfile),
    '@konkon-lab/foxpanel-window': outfile => fs.writeFileSync(outfile, `${shim.join('\n')}\n`),
  };
  fs.mkdirSync(lib, { recursive: true });
  await Promise.all((Object.keys(make) as LibName[]).map(name => make[name](path.join(lib, WINDOW_LIBS[name]))));
}

// 打进产物的 npm 包(metafile 里实际带着代码的，加上原样复制的)的许可证全文写成 dist/ 下的一份文本
function writeLicenses(): void {
  const dirs = [...new Set([...bundledPackageDirs(metas), ...COPIED_PACKAGES])];
  fs.writeFileSync(path.join(dist, LICENSES_FILE), licensesText(dirs.map(dir => readPackage(path.join(root, dir)))));
}

// 把页面的 import map 写成 libs 这张表(HTML 里 importmap 脚本的内容整个换掉，缩进照 HTML 的层级)；
// import map 是内联脚本，它的 sha256 要加进 CSP 的 script-src
function writeImportMap(html: string, libs: Readonly<Record<string, string>>): void {
  const toLib = path.relative(path.dirname(html), lib).split(path.sep).join('/');
  const base = toLib.startsWith('.') ? toLib : `./${toLib}`;
  const imports = Object.entries(libs).map(([name, file]) => `${JSON.stringify(name)}: ${JSON.stringify(`${base}/${file}`)}`);
  const map = `\n    { "imports": { ${imports.join(', ')} } }\n  `;
  const hash = crypto.createHash('sha256').update(map).digest('base64');
  const text = fs.readFileSync(html, 'utf8');
  const tag = /(<script type="importmap">)[\s\S]*?(<\/script>)/;
  const csp = /script-src ([^;"]*);/;
  if (!tag.test(text) || !csp.test(text)) throw new Error(`${html} 里没有 import map 或 CSP 的 script-src`);
  fs.writeFileSync(html, text.replace(tag, (_all, open: string, close: string) => `${open}${map}${close}`).replace(csp, `script-src $1 'sha256-${hash}';`));
}

await Promise.all([
  bundleCode({ ...nodeCode, entryPoints: [path.join(root, 'src/main/main.ts')], outfile: path.join(dist, 'main.js'), format: 'esm', packages: 'external' }),
  bundleCode({ ...nodeCode, entryPoints: [path.join(root, 'src/component-host/main.ts')], outfile: path.join(dist, 'component-host.js'), format: 'esm', packages: 'external' }),
  // 在 utilityProcess 里跑 yarn.cjs 的入口(CJS，要 require yarn.cjs)
  bundleCode({ ...nodeCode, entryPoints: [path.join(root, 'src/yarn-host/main.ts')], outfile: path.join(dist, 'yarn-host.cjs'), format: 'cjs' }),
  bundleCode({ ...nodeCode, entryPoints: [path.join(root, 'src/preload/preload.ts')], outfile: path.join(dist, 'preload.cjs'), format: 'cjs', external: ['electron'] }),
  bundleCode({ ...nodeCode, entryPoints: [path.join(root, 'src/preload/page.ts')], outfile: path.join(dist, 'preload-page.cjs'), format: 'cjs', external: ['electron'] }),
  viteBuild({ configFile: path.join(root, 'vite.config.ts'), logLevel: 'warn' }),
  viteBuild({
    configFile: false,
    root: path.join(root, 'src/panel'),
    base: './',
    logLevel: 'warn',
    plugins: [vue()],
    build: {
      outDir: path.join(dist, 'host'),
      emptyOutDir: false,
      target: 'es2023',
      sourcemap: true,
      modulePreload: false,
      rollupOptions: { input: { panel: path.join(root, 'src/panel/panel.html'), media: path.join(root, 'src/panel/media.html') }, external: PANEL_SHARED },
    },
  }),
  buildIcons(root, dist),
  buildSharedLibs(),
  buildComponents(),
  buildDevComponents(),
]);
writeImportMap(path.join(dist, 'host', 'panel.html'), PANEL_LIBS);
writeImportMap(path.join(dist, 'host', 'media.html'), PANEL_LIBS);
writeImportMap(path.join(dist, 'host', 'window', 'index.html'), WINDOW_LIBS);
writeLicenses();
