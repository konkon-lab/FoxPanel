// 组件管理：组件目录 + secret + 开发文件夹监视 + 从 npm 装组件(yarn.ts、market.ts)，处理主窗口的组件 IPC。
// 改动保存后发布：新列表推给主窗口，再通知宿主(面板页面、媒体页面、远程服务、应用信息、组件进程跟着更新)。
// 只有磁盘上要读的组件会变的操作(安装、卸载、npm、开发文件夹的增减和改动、开发者模式开关)重新扫描组件目录。

import { dialog, safeStorage, shell, utilityProcess, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { ComponentStore } from './store.ts';
import { applyPatch, parsePatch, secretKey, type SecretDef } from './settings.ts';
import type { HostsComponent } from './hosts.ts';
import { Yarn } from './yarn.ts';
import { Market } from './market.ts';
import { PACKAGE_NAME } from '../../shared/market.ts';
import { SecretStore } from './secrets.ts';
import { ComponentStorage } from './storage.ts';
import { SINGLE_KINDS, type Manifest } from '../../shared/manifest.ts';
import { verifyUser } from '../desktop.ts';
import { POLICY, type Ipc } from '../ipc.ts';
import { BUS_COMPONENT_REMOVED, IPC, type CodeComponent, type ComponentFeature, type ComponentRow, type Log, type SecretReveal, type ComponentList, type ComponentPatch, type ComponentPreview, type ComponentResult, type ComponentSettings, type HostStatus, type NpmOp } from '../../shared/types.ts';
import { errorText, isObject } from '../../shared/util.ts';

const RELOAD_MS = 300;   // 开发文件夹改动后等这么久再重载(毫秒；合并连续的保存)
// 类别名就是功能名的类别：这类组件在键盘上用着时算正在提供这项功能
const KEYBOARD_FEATURES: readonly ComponentFeature[] = ['candidates', 'textfield', 'layout', 'skin', 'sidepage', 'sidebutton', 'lang'];

export interface ManagerDeps {
  userData: string;
  preinstalled: string;
  extra?: readonly string[];              // 只在这次运行加载的组件文件夹(开发用的显示方)
  yarn: string;                           // 自带的 yarn.cjs
  yarnHost: string;                       // 在 utilityProcess 里跑 yarn.cjs 的入口(dist/yarn-host.cjs)
  version: string;                        // 程序版本(组件包要的宿主版本按它比)
  get(): ComponentSettings;
  save(s: ComponentSettings): void;       // 保存设置
  changed(): void;                        // 组件或设置变了：面板页面、媒体页面、远程服务、应用信息、组件进程要跟着更新
  bus(channel: string, data: unknown): void;   // 核心的通知发到组件总线(组件进程、各页面)
  // 组件进程：状态、加载出错的组件、注册了的发送目标和听写、有没有翻译
  host(): { status: HostStatus; errors: ReadonlyMap<string, string>; outputs: readonly { id: string }[]; inputs: readonly string[]; translator: boolean; restart(): void };
  window(): BrowserWindow | null;
  pageErrors?(): ReadonlyMap<string, string>;   // 面板页面出错的组件：组件 id → 原因(列表里显示在这个组件上)
  log: Log;
}

// 组件进程里注册了的功能(发送目标和听写的组件 id、有没有翻译)和面板目录里的面板 id
interface Registered {
  outputs: ReadonlySet<string>;
  inputs: ReadonlySet<string>;
  translator: boolean;
  panels: ReadonlySet<string>;
}

// 组件正在提供的功能：主进程组件看组件进程里实际注册了什么，声明了面板的看它在不在面板目录里，键盘上的组件看是否正在用
function featuresOf(r: ComponentRow, registered: Registered): ComponentFeature[] {
  const out: ComponentFeature[] = [];
  if (registered.outputs.has(r.id)) out.push('output');
  if (registered.inputs.has(r.id)) out.push('dictation');
  if (r.kind === 'translator' && r.active && registered.translator) out.push('translation');
  if (registered.panels.has(r.id)) out.push('panel');
  const own = KEYBOARD_FEATURES.find(f => f === r.kind);
  if (r.active && own) out.push(own);
  return out;
}

const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: errorText(e) });

// 跑一个操作：成功时 { ok: true }，抛出的异常转成 { ok: false, error }
async function attempt(run: () => void | Promise<void>): Promise<ComponentResult> {
  try {
    await run();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// 页面发来的 npm 操作(IPC 参数)收窄；格式不对时为 null
function parseNpmOp(raw: unknown): NpmOp | null {
  if (!isObject(raw)) return null;
  const { op, name, version } = raw;
  if (typeof name !== 'string') return null;
  if (op === 'add' && typeof version === 'string') return { op, name, version };
  return op === 'remove' ? { op, name } : null;
}

export class ComponentManager {
  readonly store: ComponentStore;
  readonly secrets: SecretStore;
  readonly storage: ComponentStorage;
  readonly yarn: Yarn;
  readonly market: Market;
  private readonly deps: ManagerDeps;
  private watchers: fs.FSWatcher[] = [];
  private reloadTimer: NodeJS.Timeout | undefined;
  private listTimer: NodeJS.Immediate | undefined;   // 排着的一次「列表推给主窗口」
  private windowSignature = '';   // 上次给主窗口的页面组件计划

  constructor(deps: ManagerDeps) {
    this.deps = deps;
    this.store = new ComponentStore({ dir: path.join(deps.userData, 'components'), preinstalled: deps.preinstalled, log: deps.log, ...(deps.extra ? { extra: deps.extra } : {}) });
    this.storage = new ComponentStorage(path.join(deps.userData, 'component-data'));
    this.yarn = new Yarn({
      dir: path.join(deps.userData, 'components'), yarn: deps.yarn, log: deps.log,
      fork: (script, args, o) => utilityProcess.fork(deps.yarnHost, [script, ...args], { cwd: o.cwd, env: o.env, stdio: 'pipe', serviceName: 'FoxPanel yarn' }),
      registry: () => deps.get().market.registry, scripts: () => deps.get().market.scripts,
    });
    this.market = new Market(() => deps.get().market.registry, deps.version);
    this.secrets = new SecretStore(path.join(deps.userData, 'secrets.json'), {
      encrypt: async text => {
        if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('系统加密不可用，不能保存');
        return (await safeStorage.encryptStringAsync(text)).toString('base64');
      },
      decrypt: async stored => (await safeStorage.decryptStringAsync(Buffer.from(stored, 'base64'))).result,
    });
  }

  // 预装组件同步进来(新装上的排到最后)，扫描，开始监视开发文件夹
  start(): void {
    const s = this.deps.get();
    const added = this.store.syncPreinstalled(s.removed).filter(id => !s.order.includes(id));
    this.yarn.prepare();
    this.rescan();
    // 新装上的预装组件：清单写了 enabled: false 的先关着
    const off = added.filter(id => this.store.get(id)?.manifest.enabled === false);
    if (added.length) this.deps.save({ ...s, order: [...s.order, ...added], off: [...s.off, ...off.filter(id => !s.off.includes(id))] });
    // secret 解密完，列表里才有预览
    void this.secrets.warm().then(() => this.pushList());
  }

  stop(): void {
    this.unwatch();
    clearTimeout(this.reloadTimer);
    clearImmediate(this.listTimer);
  }

  // 主窗口要加载的页面组件
  windowComponents(): CodeComponent[] {
    return this.store.windowComponents(this.deps.get());
  }

  list(): ComponentList {
    const s = this.deps.get();
    const host = this.deps.host();
    // 组件进程一侧各项每读一次都从各进程汇总一遍，这里各读一次
    const errors = host.errors;
    const pageErrors = this.deps.pageErrors?.();
    const registered: Registered = {
      outputs: new Set(host.outputs.map(o => o.id)), inputs: new Set(host.inputs), translator: host.translator,
      panels: new Set(this.store.panelInfos(s).map(p => p.id)),
    };
    const rows = this.store.rows(s, (id, key) => this.secrets.has(id, key), (id, key) => this.secrets.hint(id, key));
    for (const r of rows) {
      const error = errors.get(r.id) ?? pageErrors?.get(r.id);
      if (error) r.error = error;
      const features = featuresOf(r, registered);
      if (features.length) r.features = features;
    }
    return { rows, broken: [...this.store.broken], devMode: s.devMode, host: host.status };
  }

  // 重新扫描(开发文件夹只在开发者模式下读)，重新监视
  private rescan(): void {
    const s = this.deps.get();
    this.store.scan(s.devMode ? s.dev : [], this.yarn.dependencies());
    this.unwatch();
    if (!s.devMode) return;
    for (const dir of s.dev) {
      try {
        this.watchers.push(fs.watch(dir, { recursive: true }, () => this.devChanged()));
      } catch (e) {
        this.deps.log(`cannot watch ${dir}: ${errorText(e)}`, 'warn');
      }
    }
  }

  private unwatch(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
  }

  private devChanged(): void {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.deps.log('dev folder changed, reloading');
      this.refresh();
    }, RELOAD_MS);
  }

  // 组件进程的状态变了：列表推给主窗口；同一轮事件循环里的多次合成一次
  hostChanged(): void {
    this.listTimer ??= setImmediate(() => this.pushList());
  }

  // 列表推给主窗口(排着的那一次不用另推)
  private pushList(): void {
    clearImmediate(this.listTimer);
    this.listTimer = undefined;
    const w = this.deps.window();
    if (w && !w.isDestroyed()) w.webContents.send(IPC.compListEvent, this.list());
  }

  // 主进程组件要加载的列表：设置里带上解密后的 secret(几个组件共用的 secret 只解密一次)
  async mainComponents(): Promise<HostsComponent[]> {
    const decrypted = new Map<string, Promise<string>>();
    const secret = (at: [string, string]): Promise<string> => {
      const k = at.join('/');
      let v = decrypted.get(k);
      if (!v) decrypted.set(k, v = this.secrets.get(...at));
      return v;
    };
    return Promise.all(this.store.mainComponents(this.deps.get()).map(async ({ config, secrets, ...c }) => {
      const out = { ...config };
      for (const { key, at } of secrets) out[key] = await secret(at);
      return { ...c, config: out };
    }));
  }

  // 应用一个改动(主进程组件要的开关输出组件也走这里)；不合格时抛出异常
  apply(patch: ComponentPatch): void {
    this.deps.save(applyPatch(this.deps.get(), patch, this.store.all));
    // 开发者模式的开关决定读不读开发文件夹；别的改动不影响磁盘上要读哪些组件
    if (patch.kind === 'devMode') this.rescan();
    this.publish();
  }

  // 发布组件和设置的最新状态：列表推给主窗口，主窗口的页面组件变了另外通知，再通知宿主
  private publish(): void {
    this.pushList();
    const w = this.deps.window();
    if (w && !w.isDestroyed()) {
      const plan = this.windowComponents();
      const sig = JSON.stringify(plan);
      if (sig !== this.windowSignature) w.webContents.send(IPC.windowPlanEvent, plan);
      this.windowSignature = sig;
    }
    this.deps.changed();
  }

  // 磁盘上要读的组件变了：重新扫描并发布
  private refresh(): void {
    this.rescan();
    this.publish();
  }

  // 跑一个改磁盘的操作；失败时磁盘上可能已经变了一部分：重新扫描并发布，异常照常抛出
  private async onDisk<T>(run: () => T | Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      this.refresh();
      throw e;
    }
  }

  // 装上一个组件(已重新扫描)之后：排到最后、从 removed 里拿掉；新装的只能开一个的类别或清单写了不开的先关着
  private installed(m: Manifest, fresh: boolean): void {
    const s = this.deps.get();
    const hold = fresh && (!m.enabled || SINGLE_KINDS.has(m.kind));
    this.deps.save({
      ...s, order: s.order.includes(m.id) ? s.order : [...s.order, m.id], removed: s.removed.filter(x => x !== m.id),
      off: hold && !s.off.includes(m.id) ? [...s.off, m.id] : s.off,
    });
    this.publish();
  }

  // 卸掉一个组件(已重新扫描)之后：删它的设置、secret、数据和顺序，预装的记进 removed；经总线通知各组件
  private forget(id: string): void {
    const s = this.deps.get();
    const config = { ...s.config };
    delete config[id];
    const preinstalled = this.store.preinstalledIds().includes(id);
    this.secrets.removeAll(id);
    this.storage.removeAll(id);
    this.deps.save({
      ...s, config, order: s.order.filter(x => x !== id), off: s.off.filter(x => x !== id),
      removed: preinstalled && !s.removed.includes(id) ? [...s.removed, id] : s.removed,
    });
    this.publish();
    this.deps.bus(BUS_COMPONENT_REMOVED, id);
  }

  // 取消登记一个开发文件夹(不删文件夹)
  private dropDev(dir: string): void {
    const s = this.deps.get();
    this.deps.save({ ...s, dev: s.dev.filter(d => d !== dir) });
    this.refresh();
  }

  // 从 npm 装上(或换版本)、卸载一个组件包
  private async npm(op: NpmOp): Promise<void> {
    if (!PACKAGE_NAME.test(op.name)) throw new Error(`不是组件包：${op.name}`);
    await (op.op === 'add' ? this.npmAdd(op.name, op.version) : this.npmRemove(op.name));
  }

  // 装之前按仓库里的包信息检查；装完用包里的 component.json 再校验，不合格就卸掉
  private async npmAdd(name: string, version: string): Promise<void> {
    const info = await this.market.info(name, version);
    const want = info.component;
    if (!want) throw new Error(`${name}@${info.version} 不是 FoxPanel 组件：package.json 没有合格的 foxpanel 字段`);
    if (!info.compatible) throw new Error(`${name}@${info.version} 要的宿主版本是 ${info.sdk ?? ''}，这个程序是 ${this.deps.version}`);
    if (info.readyAt !== undefined) throw new Error(`${name}@${info.version} 发布不满一天，${info.readyAt ? new Date(info.readyAt).toLocaleString() : '过一天'} 后才能装`);
    const fresh = !this.store.get(want.id);
    await this.onDisk(() => this.yarn.run(['add', `${name}@${info.version}`]));
    this.rescan();
    const c = this.store.all.find(x => x.npm === name);
    if (!c || c.manifest.id !== want.id) {
      const broken = this.store.broken.find(b => b.name === name);
      await this.yarn.run(['remove', name]).catch(() => undefined);
      this.refresh();
      throw new Error(c ? `包里组件的 id ${c.manifest.id} 和 package.json 写的 ${want.id} 不一致` : `包里的 component.json 不合格：${broken?.errors.join('；') ?? ''}`);
    }
    this.deps.log(`installed ${name}@${info.version}`, 'info', want.id);
    this.installed(c.manifest, fresh);
  }

  // 卸掉包；同 id 的文件夹组件还装着(之前被这个包盖住)时，设置和数据留给它
  private async npmRemove(name: string): Promise<void> {
    const id = this.store.all.find(x => x.npm === name)?.manifest.id;
    await this.onDisk(() => this.yarn.run(['remove', name]));
    this.deps.log(`uninstalled ${name}`, 'info', id);
    this.rescan();
    if (id && !this.store.get(id)) this.forget(id);
    else this.publish();
  }

  private openDialog(opts: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
    const w = this.deps.window();
    return w ? dialog.showOpenDialog(w, opts) : dialog.showOpenDialog(opts);
  }

  // 选一个组件 zip，解开检查，等确认后再装
  private async pick(): Promise<ComponentPreview> {
    const r = await this.openDialog({ title: '安装组件', filters: [{ name: '组件', extensions: ['zip'] }], properties: ['openFile'] });
    const file = r.filePaths[0];
    if (r.canceled || !file) return { ok: false, cancelled: true };
    const preview = this.store.stage(file);
    if (preview.ok) this.deps.log(`unpacked ${preview.manifest.id} ${preview.manifest.version} (${file})`);
    else this.deps.log(`cannot unpack ${file}: ${'error' in preview ? preview.error : ''}`, 'warn');
    return preview;
  }

  // 装上选好的 zip；confirm 为 false 时放弃
  private async confirmInstall(confirm: boolean): Promise<void> {
    if (!confirm) return this.store.discard();
    const id = this.store.stagedId;
    const fresh = !(id && this.store.get(id));
    const m = await this.onDisk(() => this.store.install());
    this.deps.log(`installed ${m.version}`, 'info', m.id);
    this.rescan();
    this.installed(m, fresh);
  }

  // 卸载：npm 装的卸包；开发中的只取消登记；其余删组件目录里的文件夹
  private async remove(id: string): Promise<void> {
    const c = this.store.get(id);
    if (c?.npm) return this.npm({ op: 'remove', name: c.npm });
    if (c?.dev) {
      this.dropDev(c.dir);
      this.deps.log(`removed dev folder ${c.dir}`, 'info', id);
      return;
    }
    await this.onDisk(() => this.store.remove(id));
    this.deps.log('uninstalled', 'info', id);
    this.rescan();
    this.forget(id);
  }

  // 移除一个不能加载的组件：npm 包卸掉，开发文件夹取消登记，组件目录里的文件夹删掉
  private async removeBroken(folder: string): Promise<void> {
    const packages = this.yarn.dependencies();
    const pkg = this.store.broken.find(b => b.folder === folder && !b.dev && Object.hasOwn(packages, b.name));
    if (pkg) return this.npm({ op: 'remove', name: pkg.name });
    if (this.deps.get().dev.includes(folder)) return this.dropDev(folder);
    await this.onDisk(() => this.store.removeBroken(folder));
    this.refresh();
  }

  // 清单里的一个 secret 设置项；没有这个组件或这一项不是 secret 时为 undefined
  private secretDef(id: string, key: string): SecretDef | undefined {
    const d = this.store.get(id)?.manifest.settings.find(x => x.key === key);
    return d?.type === 'secret' ? d : undefined;
  }

  // 保存一个 secret；空字符串 = 清除
  private async setSecret(id: string, key: string, value: string): Promise<void> {
    const def = this.secretDef(id, key);
    if (!def) throw new Error('没有这个设置项');
    await this.secrets.set(...secretKey(id, def), value);
    // 日志里写成分开的词：apiKey → api key
    const words = key.replace(/([A-Z])/g, ' $1').toLowerCase();
    this.deps.log(`${words} ${value ? 'updated' : 'cleared'}`, 'info', id);
    this.publish();
  }

  // 显示 secret 明文：要过 Windows 安全验证
  private async revealSecret(id: string, key: string): Promise<SecretReveal> {
    const def = this.secretDef(id, key);
    if (!def || !this.secrets.has(...secretKey(id, def))) return { ok: false, error: 'noKey' };
    const denied = await verifyUser('显示 API Key');
    if (denied) return { ok: false, error: denied };
    return { ok: true, value: await this.secrets.get(...secretKey(id, def)) };
  }

  // 选一个文件夹按开发中的组件加载：登记进 dev，排到顺序最后
  private async addDevFolder(): Promise<void> {
    const r = await this.openDialog({ title: '从文件夹加载组件', properties: ['openDirectory'] });
    const dir = r.filePaths[0];
    if (r.canceled || !dir) return;
    const read = ComponentStore.read(dir);
    if (!read.ok) throw new Error(read.errors.join('；'));
    const s = this.deps.get();
    const id = read.manifest.id;
    this.deps.save({ ...s, dev: s.dev.includes(dir) ? s.dev : [...s.dev, dir], order: s.order.includes(id) ? s.order : [...s.order, id] });
    this.refresh();
    this.deps.log(`loading dev folder ${dir}`, 'info', id);
  }

  // 在资源管理器里打开一个文件夹；只打开登记过的组件文件夹
  private async openFolder(folder: string): Promise<void> {
    const known = this.store.all.some(c => c.dir === folder) || this.store.broken.some(b => b.folder === folder);
    if (known) await shell.openPath(folder);
  }

  // 各通道经 ipc 注册(谁能调见 POLICY)：参数收窄后交给上面的方法
  registerIpc(ipc: Ipc): void {
    const badArgs = fail('参数不对');
    ipc.handle(IPC.compList, POLICY.compList, (): ComponentList => this.list());
    ipc.handle(IPC.windowPlan, POLICY.windowPlan, (): CodeComponent[] => {
      const plan = this.windowComponents();
      this.windowSignature = JSON.stringify(plan);
      return plan;
    });
    ipc.handle(IPC.compPick, POLICY.compPick, (): Promise<ComponentPreview> => this.pick());
    ipc.handle(IPC.compInstall, POLICY.compInstall, (_e, confirm) => attempt(() => this.confirmInstall(confirm === true)));
    ipc.handle(IPC.compRemove, POLICY.compRemove, (_e, id) => (typeof id === 'string' ? attempt(() => this.remove(id)) : badArgs));
    ipc.handle(IPC.compRemoveBroken, POLICY.compRemoveBroken, (_e, folder) => (typeof folder === 'string' ? attempt(() => this.removeBroken(folder)) : badArgs));
    ipc.handle(IPC.compSet, POLICY.compSet, (_e, patch) => attempt(() => this.apply(parsePatch(patch))));
    ipc.handle(IPC.compSecret, POLICY.compSecret, (_e, id, key, value) => (
      typeof id === 'string' && typeof key === 'string' && typeof value === 'string' ? attempt(() => this.setSecret(id, key, value)) : badArgs
    ));
    ipc.handle(IPC.compSecretReveal, POLICY.compSecretReveal, async (_e, id, key): Promise<SecretReveal> => (
      typeof id === 'string' && typeof key === 'string' ? this.revealSecret(id, key) : { ok: false, error: 'failed' }
    ));
    ipc.handle(IPC.compDevAdd, POLICY.compDevAdd, () => attempt(() => this.addDevFolder()));
    ipc.handle(IPC.compHostRestart, POLICY.compHostRestart, () => this.deps.host().restart());
    ipc.handle(IPC.compNpm, POLICY.compNpm, async (_e, raw): Promise<ComponentResult> => {
      const op = parseNpmOp(raw);
      if (!op) return badArgs;
      const r = await attempt(() => this.npm(op));
      if (!r.ok) this.deps.log(r.error, 'warn', 'market');
      return r;
    });
    ipc.handle(IPC.marketSearch, POLICY.marketSearch, (_e, refresh) => (
      this.market.search(refresh === true).then(items => ({ ok: true as const, items }), fail)
    ));
    ipc.handle(IPC.marketInfo, POLICY.marketInfo, (_e, name, version) => {
      if (typeof name !== 'string' || (version !== undefined && typeof version !== 'string')) return badArgs;
      return this.market.info(name, version).then(pkg => ({ ok: true as const, pkg }), fail);
    });
    ipc.handle(IPC.storageCall, POLICY.storageCall, (_e, id, call) => {
      if (typeof id !== 'string') throw new Error('参数不对');
      return this.storage.call(id, call);
    });
    ipc.handle(IPC.compOpenFolder, POLICY.compOpenFolder, (_e, folder) => (typeof folder === 'string' ? this.openFolder(folder) : undefined));
  }
}
