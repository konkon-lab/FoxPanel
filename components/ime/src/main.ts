// 输入法组件(独立进程)：键盘引擎——rime(工作线程)、韩文、搜狗词库、语言文件同步，加上输入框、候选、发送、自动送出、PIN、
// 翻译、听写这条流程。状态经远程服务 keyboard 发布，键盘面板里的部件和别的组件发来的操作、听写结果从它收(收窄在 served.ts)。
// 输出、听写、界面语言、语言组件的情况读应用信息(ctx.app)；发送、「正在输入」、清除走 ctx.output，开关输出和剪贴板走 ctx.app，
// 翻译走 ctx.translator，开关听写走 ctx.input。
// rime 用户目录是数据文件夹的 rime/；引擎和内置词库在程序目录的 vendor/rime。键盘设置、搜狗导入的条数存在本组件的数据里。
// 主窗口部分(window.ts)经总线要语言列表、改模式、导入搜狗词库。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppInfo, ImePack, KeyboardSettings, MainContext, Manifest } from '@konkon-lab/foxpanel-sdk';
import { isObject } from '../../_shared/util.ts';
import { GET, LANGS, MODE, SOGOU, SOGOU_DONE, type LangsInfo } from './channels.ts';
import { ImeClient } from './client.ts';
import { PINYIN_SCHEMA } from './imepack.ts';
import { KeyboardService } from './keyboard.ts';
import { LangFiles, writeIfChanged } from './langs.ts';
import { keyboardCalls } from './served.ts';
import { normalizeKeyboard } from './settings.ts';

// 本组件数据里的键
const SETTINGS = 'settings';        // 键盘设置
const SOGOU_WORDS = 'sogouWords';   // 已导入的搜狗词条数

// rime 用户目录里内置方案的补丁(schema_list 按已装的语言生成)：
// 四叶草关掉 emoji 联想和符号(VRChat 聊天框显示不了 emoji)；jaroomaji 默认用日文模式；easy_en 只留 uniquifier 过滤器(它的 Lua 过滤器需要另装脚本)
const RIME_PATCHES: Readonly<Record<string, string>> = {
  'clover.custom.yaml': 'patch:\n  "switches/@1/reset": 0\n  "switches/@2/reset": 0\n',
  'jaroomaji.custom.yaml': 'patch:\n  "switches/@0/reset": 0\n',
  'easy_en.custom.yaml': 'patch:\n  engine/filters:\n    - uniquifier\n',
};

export default {
  name: 'yanuo.ime',
  async apply(ctx: MainContext) {
    const log: MainContext['log'] = (text, level) => ctx.log(text, level);
    const vendor = path.join(ctx.appDir, 'vendor', 'rime');
    const rimeRoot = path.join(ctx.dataDir, 'rime');
    const rimePaths = {
      dll: path.join(vendor, 'rime.dll'), shared: `${path.join(vendor, 'data')}${path.sep}`, user: path.join(rimeRoot, 'data'),
      prebuilt: path.join(rimeRoot, 'prebuilt'), staging: path.join(rimeRoot, 'build'), log: path.join(rimeRoot, 'log'),
    };
    for (const p of [rimePaths.user, rimePaths.prebuilt, rimePaths.staging, rimePaths.log]) fs.mkdirSync(p, { recursive: true });
    for (const [file, text] of Object.entries(RIME_PATCHES)) writeIfChanged(path.join(rimePaths.user, file), text);
    const files = new LangFiles({ user: rimePaths.user, shared: rimePaths.shared, record: path.join(rimeRoot, 'lang-files.json') }, Object.keys(RIME_PATCHES));
    const hasRime = fs.existsSync(rimePaths.dll);
    if (!hasRime) log('missing vendor/rime, run npm run vendor:rime', 'error');

    // 键盘设置和搜狗词条数：存在本组件的数据里
    let settings: KeyboardSettings = normalizeKeyboard(await ctx.storage.get(SETTINGS));
    const storedWords = await ctx.storage.get(SOGOU_WORDS);
    let sogouWords = typeof storedWords === 'number' && Number.isFinite(storedWords) ? storedWords : 0;
    const save = (patch: Partial<KeyboardSettings>): void => {
      settings = normalizeKeyboard(patch, settings);
      void ctx.storage.set(SETTINGS, settings);
      announce();
    };

    // 应用信息里键盘用到的几项：界面语言、输出组件、有没有听写；语言组件另外记在 allPacks / packs
    let info: Pick<AppInfo, 'locale' | 'outputs' | 'canDictate'> = ctx.app.info;
    let allPacks: ImePack[] = [];   // 已装且能用的语言
    let packs: ImePack[] = [];      // 其中开着的，按语言面板顺序
    let installedSig = '';
    // 语言组件有变：已装的变了才同步进 rime 用户目录(返回用户目录有没有变，变了要重新部署)；开关和顺序只重排 packs
    const useLangs = (installed: readonly { dir: string; manifest: Manifest }[], active: readonly string[]): boolean => {
      const sig = JSON.stringify(installed);
      let changed = false;
      if (sig !== installedSig) {
        installedSig = sig;
        ({ packs: allPacks, changed } = files.apply(installed, log));
        announce();
      }
      packs = active.flatMap(id => allPacks.filter(p => p.id === id));
      return changed;
    };

    // 给主窗口部分：全部语言的方案和模式、当前各语言的模式、搜狗词条数
    function announce(): void {
      const langsInfo: LangsInfo = {
        langs: allPacks.map(p => ({ id: p.id, pinyin: p.schema === PINYIN_SCHEMA, modes: p.modes.map(m => ({ id: m.id, label: m.label })) })),
        modes: settings.modes,
        sogouWords,
      };
      ctx.bus.send(LANGS, langsInfo);
    }
    ctx.effect(() => ctx.bus.on(GET, () => announce()));
    ctx.effect(() => ctx.bus.on(MODE, v => {
      if (isObject(v) && typeof v['id'] === 'string' && typeof v['mode'] === 'string') kb.setMode(v['id'], v['mode']);
    }));
    ctx.effect(() => ctx.bus.on(SOGOU, () => {
      void kb.importSogou().then(result => ctx.bus.send(SOGOU_DONE, result));
    }));

    const kb = new KeyboardService({
      settings: () => settings,
      save,
      sogouImported: count => {
        sogouWords = count;
        void ctx.storage.set(SOGOU_WORDS, count);
        announce();
      },
      output: (p, live) => ctx.output.send(p, live),
      hasLive: () => info.outputs.some(o => o.on && o.live),
      hasTyping: () => info.outputs.some(o => o.on && o.typing),
      typing: on => ctx.output.typing(on),
      clearOutputs: () => ctx.output.clear(),
      setOutput: (id, on) => ctx.app.setOn(id, on),
      outputs: () => info.outputs.map(({ id, name, on }) => ({ id, name, on })),
      translate: text => ctx.translator.translate(text),
      dictate: on => ctx.input.dictate(on),
      canDictate: () => info.canDictate,
      clipboard: ctx.app.clipboard,
      broadcast: state => serving.publish(state),
      log,
      // koffi 模块地址给工作线程：它在数据文件夹里找不到程序自带的那份
      ime: new ImeClient(fileURLToPath(new URL('./worker.js', import.meta.url)), import.meta.resolve('koffi'), log),
      rimePaths,
      hanjaFile: path.join(vendor, 'hanja.txt'),
      packs: () => packs,
      uiLang: () => info.locale,
    });

    // 远程服务 keyboard：键盘面板里的部件和别的组件读状态、发操作；听写结果只收接了听写的输入源发来的
    const serving = ctx.relay.serve('keyboard', keyboardCalls(kb, () => ctx.app.info.inputs));

    // 应用信息：键盘用到的几项(界面语言、输出组件、有没有听写、语言组件)变了才跟上，别的组件的开关和顺序不管
    let infoSig = '';
    const useInfo = (next: AppInfo): void => {
      const langs = next.components.filter(c => c.kind === 'lang');
      const installed = langs.map(c => ({ dir: c.dir, manifest: c.manifest }));
      const active = langs.filter(c => c.active).map(c => c.id);
      const sig = JSON.stringify([next.locale, next.outputs, next.canDictate, installed, active]);
      if (sig === infoSig) return;
      infoSig = sig;
      info = next;
      const redeploy = useLangs(installed, active);
      // 语言列表有了才定当前语言：rime 没启动时启动它(启动时部署，不用另外重新部署)
      if (hasRime && kb.engineState === 'off') void kb.start();
      else if (redeploy) void kb.redeploy();
      else kb.refresh();
    };
    useInfo(ctx.app.info);
    ctx.effect(() => ctx.app.watch(useInfo));
    ctx.effect(() => () => kb.stop());
  },
};
