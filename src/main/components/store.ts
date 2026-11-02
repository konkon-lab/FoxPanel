// 组件目录：userData/components/<id>/。预装组件启动时同步进来，之后和别的组件一样处理(能卸载)；
// 这个目录同时是组件项目，从 npm 装的组件在 node_modules/<包名>/(见 yarn.ts)，同 id 时 npm 装的优先；
// 开发者模式下另外读登记的文件夹，同 id 时文件夹里的优先。按设置里的开关和顺序给出各种页面和组件进程要加载的组件。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isComponentId, MEDIA_KINDS, parseManifest, PART_KINDS, SINGLE_KINDS, type ComponentKind, type Manifest } from '../../shared/manifest.ts';
import type { AppInfo } from '../../shared/host-protocol.ts';
import type { BrokenComponent, CodeComponent, ComponentPreview, ComponentRow, ComponentSettings, Log, MediaPlan, PageComponent, PanelInfo, PanelPlan } from '../../shared/types.ts';
import { errorText } from '../../shared/util.ts';
import { compareVersions } from '../../shared/version.ts';
import type { HostsComponent } from './hosts.ts';
import { configOf, readPreinstalled, secretKey, sortByOrder } from './settings.ts';

export interface Installed {
  dir: string;
  manifest: Manifest;
  dev: boolean;
  code: boolean;         // 带代码(见 hasCode)
  extra?: true;          // 只在这次运行加载的(见 ComponentStoreDeps.extra)
  npm?: string;          // 从 npm 装的：包名
  layout?: unknown;      // 读好的布局 JSON(格式由按键渲染校验)
}

// 一个 secret 设置项：设置的 key 和它在 SecretStore 里的位置
export interface SecretRef {
  key: string;
  at: [string, string];
}

// 组件进程要加载的一个组件；config 不含 secret，secrets 列出要填进 config 的
export interface MainComponent extends HostsComponent {
  secrets: SecretRef[];
}

export interface ComponentStoreDeps {
  dir: string;           // 组件目录
  preinstalled: string;  // 预装组件(构建产物)，含 preinstalled.json 列出的顺序
  // 只在这次运行加载的组件文件夹(开发用的显示方)：不放进组件目录，一直开着、排在全部组件前面，不出现在组件列表和应用信息里
  extra?: readonly string[];
  log: Log;
}

const MANIFEST = 'component.json';
const STAGING = '.staging';            // 组件目录下放解开待确认的 zip 的文件夹
const NODE_MODULES = 'node_modules';   // 组件目录下 npm 包所在的文件夹
// Windows 自带的 bsdtar：能解 zip(不会解出 .. 和绝对路径)，-a 按扩展名打包
export const TAR = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe');

// 组件里一个文件(包内路径)的 fox:// 地址
const componentUrl = (id: string, file: string): string => `fox://component/${id}/${file.split(path.sep).join('/')}`;

// 文件的修改时间(毫秒)；读不到时 0
const mtimeOf = (file: string): number => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

// 目录内的文件 root/rel；越出目录时为 null
export function insideDir(root: string, rel: string): string | null {
  const file = path.resolve(root, rel);
  return file.startsWith(root + path.sep) ? file : null;
}

// 文件夹里有 Lua 脚本(rime 用)；only = 最外层只看这些名字
function hasLua(dir: string, only?: readonly string[]): boolean {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (only && !only.includes(e.name)) continue;
    if (e.isDirectory() ? hasLua(path.join(dir, e.name)) : e.name.toLowerCase().endsWith('.lua')) return true;
  }
  return false;
}

// 带代码：有页面入口、面板入口、主窗口入口、主进程入口，或包里有 Lua 脚本；only = 包里只有最外层的这些文件和文件夹(打包脚本用)
export const hasCode = (m: Manifest, dir: string, only?: readonly string[]): boolean =>
  m.page !== undefined || m.panel !== undefined || m.window !== undefined || m.main !== undefined || hasLua(dir, only);

// 页面要加载的一个组件里和入口无关的部分
const pageEntry = (m: Manifest, s: ComponentSettings): Pick<CodeComponent, 'id' | 'kind' | 'name' | 'config'> =>
  ({ id: m.id, kind: m.kind, name: m.name, config: configOf(m, s) });

// 组件里一个入口文件的地址，带文件的修改时间(毫秒)：文件变了地址跟着变
const entryUrl = (c: Installed, file: string): string => `${componentUrl(c.manifest.id, file)}?t=${Math.trunc(mtimeOf(path.join(c.dir, file)))}`;

// 面板页面、媒体页面要加载的一个带入口的组件
function codeEntry(c: Installed, file: string, s: ComponentSettings): CodeComponent {
  const m = c.manifest;
  return { ...pageEntry(m, s), ...(m.icon ? { icon: componentUrl(m.id, m.icon) } : {}), url: entryUrl(c, file) };
}

// 清单里的 secret 设置项
const secretsOf = (m: Manifest): SecretRef[] =>
  m.settings.flatMap(d => (d.type === 'secret' ? [{ key: d.key, at: secretKey(m.id, d) }] : []));

export class ComponentStore {
  private readonly deps: ComponentStoreDeps;
  private list: Installed[] = [];
  private byId = new Map<string, Installed>();   // list 按 id 查
  private bad: BrokenComponent[] = [];
  private staged: { root: string; manifest: Manifest } | null = null;

  constructor(deps: ComponentStoreDeps) {
    this.deps = deps;
    fs.mkdirSync(deps.dir, { recursive: true });
  }

  // 装着的组件(不含只在这次运行加载的)
  get all(): readonly Installed[] {
    return this.list.filter(c => !c.extra);
  }

  // 按设置顺序排；只在这次运行加载的排在最前
  private sorted(list: readonly Installed[], order: readonly string[]): Installed[] {
    return [...list.filter(c => c.extra), ...sortByOrder(list.filter(c => !c.extra), order)];
  }

  // 装着的一个组件；没装时为 undefined
  get(id: string): Installed | undefined {
    return this.byId.get(id);
  }

  get broken(): readonly BrokenComponent[] {
    return this.bad;
  }

  // 读一个组件文件夹的清单；不合格时返回错误
  static read(dir: string): { ok: true; manifest: Manifest } | { ok: false; errors: string[] } {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
    } catch (e) {
      return { ok: false, errors: [`读不了 ${MANIFEST}：${errorText(e)}`] };
    }
    return parseManifest(raw);
  }

  // 读一个组件：清单 + 布局 JSON(只要是 JSON)；不合格或文件夹读不了时返回错误
  static load(dir: string, dev: boolean): { ok: true; item: Installed } | { ok: false; errors: string[] } {
    const r = ComponentStore.read(dir);
    if (!r.ok) return r;
    let code: boolean;
    try {
      code = hasCode(r.manifest, dir);
    } catch (e) {
      return { ok: false, errors: [`读不了组件文件夹：${errorText(e)}`] };
    }
    const item: Installed = { dir, manifest: r.manifest, dev, code };
    if (r.manifest.layout) {
      let raw: unknown;
      try {
        raw = JSON.parse(fs.readFileSync(path.join(dir, r.manifest.layout), 'utf8'));
      } catch (e) {
        return { ok: false, errors: [`读不了 ${r.manifest.layout}：${errorText(e)}`] };
      }
      item.layout = raw;
    }
    return { ok: true, item };
  }

  // 预装列表(按默认顺序)
  preinstalledIds(): string[] {
    return readPreinstalled(this.deps.preinstalled).ids;
  }

  // 预装组件：组件目录里没有(且没被卸载过)，或预装的版本更新时复制进来；返回新装上的 id(按预装顺序)
  syncPreinstalled(removed: readonly string[]): string[] {
    const added: string[] = [];
    for (const id of this.preinstalledIds()) {
      const src = path.join(this.deps.preinstalled, id);
      const from = ComponentStore.read(src);
      if (!from.ok || from.manifest.id !== id) {
        this.deps.log('preinstalled manifest is invalid', 'error', id);
        continue;
      }
      const dest = path.join(this.deps.dir, id);
      const fresh = !fs.existsSync(dest);
      if (fresh && removed.includes(id)) continue;
      const cur = ComponentStore.read(dest);
      if (!fresh && cur.ok && compareVersions(from.manifest.version, cur.manifest.version) <= 0) continue;
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(src, dest, { recursive: true });
      if (fresh) added.push(id);
      this.deps.log(`${fresh ? 'installed' : 'updated to'} ${from.manifest.version}`, 'info', id);
    }
    return added;
  }

  // 扫描组件目录和开发文件夹；组件目录里文件夹名要和 id 一致
  scan(devDirs: readonly string[], npm: Readonly<Record<string, string>> = {}): void {
    const byId = new Map<string, Installed>();
    const bad: BrokenComponent[] = [];
    for (const name of fs.readdirSync(this.deps.dir)) {
      const dir = path.join(this.deps.dir, name);
      if (name.startsWith('.') || name === NODE_MODULES || !fs.statSync(dir).isDirectory()) continue;
      const r = ComponentStore.load(dir, false);
      if (!r.ok) bad.push({ folder: dir, name, errors: r.errors, dev: false });
      else if (r.item.manifest.id !== name) bad.push({ folder: dir, name, errors: [`文件夹名和 id ${r.item.manifest.id} 不一致`], dev: false });
      else byId.set(name, r.item);
    }
    for (const pkg of Object.keys(npm)) {
      const dir = path.join(this.deps.dir, NODE_MODULES, ...pkg.split('/'));
      const r = ComponentStore.load(dir, false);
      if (r.ok) byId.set(r.item.manifest.id, { ...r.item, npm: pkg });
      else bad.push({ folder: dir, name: pkg, errors: r.errors, dev: false });
    }
    for (const dir of devDirs) {
      const r = ComponentStore.load(dir, true);
      if (r.ok) byId.set(r.item.manifest.id, r.item);
      else bad.push({ folder: dir, name: path.basename(dir), errors: r.errors, dev: true });
    }
    for (const b of bad) this.deps.log(`${b.name} cannot load: ${b.errors.join('; ')}`, 'error');
    for (const dir of this.deps.extra ?? []) {
      const r = ComponentStore.load(dir, false);
      if (r.ok) byId.set(r.item.manifest.id, { ...r.item, extra: true });
      else this.deps.log(`${path.basename(dir)} cannot load: ${r.errors.join('; ')}`, 'error');
    }
    this.list = [...byId.values()];
    this.byId = byId;
    this.bad = bad;
  }

  // 开着的组件按设置顺序排；只能开一个的类别只取最前面的；要的服务没有在用的组件提供时不算
  // (提供者自己因为缺服务不算时，要它的组件也不算)
  active(s: ComponentSettings): Installed[] {
    const on = this.sorted(this.list.filter(c => c.extra || !s.off.includes(c.manifest.id)), s.order);
    const taken = new Set<string>();
    let list = on.filter(c => {
      if (!SINGLE_KINDS.has(c.manifest.kind)) return true;
      if (taken.has(c.manifest.kind)) return false;
      taken.add(c.manifest.kind);
      return true;
    });
    for (;;) {
      const provided = new Set(list.flatMap(c => c.manifest.provides ?? []));
      const kept = list.filter(c => (c.manifest.requires ?? []).every(x => provided.has(x)));
      if (kept.length === list.length) return kept;
      list = kept;
    }
  }

  // 提供某个服务的组件：在用的优先，其次开着的，按设置顺序；active = 在用的组件 id
  private provider(name: string, s: ComponentSettings, active: ReadonlySet<string>): Installed | null {
    const all = this.sorted(this.list.filter(c => c.manifest.provides?.includes(name)), s.order);
    return all.find(c => active.has(c.manifest.id)) ?? all.find(c => !s.off.includes(c.manifest.id)) ?? all[0] ?? null;
  }

  // 一个组件要用的服务：服务名、提供它的组件 id、它是否在用；active = 在用的组件 id
  private services(m: Manifest, s: ComponentSettings, active: ReadonlySet<string>): { name: string; id: string | null; on: boolean }[] {
    return (m.requires ?? []).map(name => {
      const p = this.provider(name, s, active);
      return { name, id: p?.manifest.id ?? null, on: p !== null && active.has(p.manifest.id) };
    });
  }

  // 远程服务 name 的提供者：开着的组件里清单 provides 有这个名字的，按设置顺序；排最前的那个生效
  providers(name: string, s: ComponentSettings): string[] {
    return this.active(s).filter(c => c.manifest.provides?.includes(name)).map(c => c.manifest.id);
  }

  // 这些组件够得着的远程服务名：各自清单 requires 和 uses 里的名字合在一起
  remotesOf(ids: Iterable<string>): string[] {
    const names = new Set<string>();
    for (const id of ids) {
      const m = this.byId.get(id)?.manifest;
      for (const name of [...m?.requires ?? [], ...m?.uses ?? []]) names.add(name);
    }
    return [...names];
  }

  // 应用信息里的组件一栏：装着的全部组件，按设置顺序
  appComponents(s: ComponentSettings): AppInfo['components'] {
    const active = new Set(this.active(s).map(c => c.manifest.id));
    return sortByOrder(this.all, s.order).map(({ dir, manifest: m }) => (
      { id: m.id, kind: m.kind, name: m.name, dir, manifest: m, on: !s.off.includes(m.id), active: active.has(m.id) }
    ));
  }

  // 已装的某一类组件，按设置顺序
  ofKind(kind: ComponentKind, s: ComponentSettings): Installed[] {
    return sortByOrder(this.all.filter(c => c.manifest.kind === kind), s.order);
  }

  // 组件进程要加载的组件：开着的、有 main 入口的(设置不含 secret，由调用方填)；mtime 是入口文件的修改时间。
  // 要用的服务的设置和 secret 并进来，组件自己的同名项优先
  mainComponents(s: ComponentSettings): MainComponent[] {
    const list = this.active(s);
    const active = new Set(list.map(c => c.manifest.id));
    return list.flatMap(({ dir, manifest: m }): MainComponent[] => {
      if (!m.main) return [];
      const file = path.join(dir, m.main);
      const config: Record<string, unknown> = {};
      const secrets: SecretRef[] = [];
      for (const name of m.requires ?? []) {
        const p = this.provider(name, s, active)?.manifest;
        if (!p) continue;
        Object.assign(config, configOf(p, s));
        secrets.push(...secretsOf(p));
      }
      Object.assign(config, configOf(m, s));
      secrets.push(...secretsOf(m));
      return [{ id: m.id, file, mtime: mtimeOf(file), own: m.process === 'own', config, secrets }];
    });
  }

  // 这些组件要用的服务，沿提供者的 requires 逐层取，其中有页面入口的提供者，按组件顺序。
  // 每个服务名取开着的组件里排最前的提供者；主窗口组件的 page 是主窗口入口，不算
  private pageServices(users: readonly Installed[], active: readonly Installed[], s: ComponentSettings): CodeComponent[] {
    const names = users.flatMap(c => c.manifest.requires ?? []);
    const seen = new Set<string>();
    const found = new Set<Installed>();
    for (let name = names.shift(); name !== undefined; name = names.shift()) {
      if (seen.has(name)) continue;
      seen.add(name);
      const wanted = name;
      const p = active.find(c => c.manifest.provides?.includes(wanted));
      if (!p) continue;
      found.add(p);
      names.push(...p.manifest.requires ?? []);
    }
    return active.flatMap(c => (found.has(c) && c.manifest.page !== undefined && c.manifest.kind !== 'window' ? [codeEntry(c, c.manifest.page, s)] : []));
  }

  // 面板目录：开着的组件声明的面板，按组件顺序
  panelInfos(s: ComponentSettings): PanelInfo[] {
    return this.active(s).flatMap(({ manifest: m }): PanelInfo[] => {
      if (!m.panel) return [];
      const { width, height, scale, fps, meters, minMeters, maxMeters, anchor, spawn, glance, keep } = m.panel;
      return [{
        id: m.id, name: m.name, ...(m.icon ? { icon: componentUrl(m.id, m.icon) } : {}),
        width, height, scale, fps, meters, minMeters, maxMeters, anchor, spawn, glance, keep,
      }];
    });
  }

  // 各块面板的页面要加载的东西，按组件顺序。根 = 清单的 panel.page；各插槽的部件 = 开着的、类别等于插槽名的部件组件
  // (有页面入口的，或只有布局 JSON 的键盘布局)，一个插槽名只归组件顺序最前的那块面板，别的面板的这个插槽是空的
  panelPlans(s: ComponentSettings): PanelPlan[] {
    const active = this.active(s);
    const skin = active.find(c => c.manifest.kind === 'skin');
    const skinUrl = skin?.manifest.skin ? entryUrl(skin, skin.manifest.skin) : null;
    const claimed = new Set<string>();
    return active.flatMap((c): PanelPlan[] => {
      const panel = c.manifest.panel;
      if (!panel) return [];
      const users = [c];
      const parts: Record<string, PageComponent[]> = {};
      for (const slot of panel.slots) {
        const mine = !claimed.has(slot);
        claimed.add(slot);
        parts[slot] = (mine ? active : []).flatMap((x): PageComponent[] => {
          if (x.manifest.kind !== slot || !PART_KINDS.has(x.manifest.kind)) return [];
          if (x.manifest.page) {
            users.push(x);
            return [codeEntry(x, x.manifest.page, s)];
          }
          if (x.layout === undefined) return [];
          users.push(x);
          return [{ ...pageEntry(x.manifest, s), ...(x.manifest.icon ? { icon: componentUrl(x.manifest.id, x.manifest.icon) } : {}), layout: x.layout }];
        });
      }
      const services = this.pageServices(users, active, s);
      return [{
        kind: 'panel', id: c.manifest.id, size: { width: panel.width, height: panel.height },
        root: codeEntry(c, panel.page, s), parts, services,
        remotes: this.remotesOf([...users.map(x => x.manifest.id), ...services.map(x => x.id)]),
        skin: skinUrl, sound: panel.sound, preview: false,
      }];
    });
  }

  // 媒体页面要加载的东西：开着的输出、输入源、翻译组件里有 page 入口的，和它们要用的服务里有页面入口的提供者
  mediaPlan(s: ComponentSettings): MediaPlan {
    const active = this.active(s);
    const users = active.filter(c => MEDIA_KINDS.has(c.manifest.kind) && c.manifest.page !== undefined);
    const components = users.flatMap(c => (c.manifest.page ? [codeEntry(c, c.manifest.page, s)] : []));
    const services = this.pageServices(users, active, s);
    return { kind: 'media', components, services, remotes: this.remotesOf([...components, ...services].map(c => c.id)) };
  }

  // 主窗口要加载的代码：开着的 window 组件的 page，其他组件的 window 入口(提供服务、往主窗口的插槽放内容)
  windowComponents(s: ComponentSettings): CodeComponent[] {
    return this.active(s).flatMap(({ manifest: m }) => {
      const entry = m.kind === 'window' ? m.page : m.window;
      return entry ? [{ ...pageEntry(m, s), url: componentUrl(m.id, entry) }] : [];
    });
  }

  // 组件管理里的列表，按设置顺序
  rows(s: ComponentSettings, secretSet: (id: string, key: string) => boolean, secretHint: (id: string, key: string) => string = () => ''): ComponentRow[] {
    const active = new Set(this.active(s).map(c => c.manifest.id));
    return sortByOrder(this.all, s.order).map(({ dir, manifest: m, dev, npm, code }) => {
      const secrets = secretsOf(m);
      const row: ComponentRow = {
        id: m.id, kind: m.kind, name: m.name, version: m.version, author: m.author, license: m.license, folder: dir,
        active: active.has(m.id), on: !s.off.includes(m.id), code, dev,
        settings: m.settings, sections: m.sections, config: configOf(m, s),
        secrets: Object.fromEntries(secrets.map(x => [x.key, secretSet(...x.at)])),
        secretHints: Object.fromEntries(secrets.map(x => [x.key, secretHint(...x.at)])),
      };
      if (npm) row.npm = npm;
      if (m.description !== undefined) row.description = m.description;
      if (m.icon) row.icon = componentUrl(m.id, m.icon);
      if (m.usage) row.usage = m.usage;
      if (m.dashboard) row.dashboard = m.dashboard;
      if (m.repository) row.repository = m.repository;
      if (m.bugs) row.bugs = m.bugs;
      if (m.provides) row.provides = m.provides;
      if (m.requires) row.requires = this.services(m, s, active);
      return row;
    });
  }

  // fox://component/<id>/<路径> → 文件；越出组件目录时为 null
  resolve(id: string, rel: string): string | null {
    const c = this.byId.get(id);
    return c ? insideDir(c.dir, rel) : null;
  }

  // 解开一个 .zip 并检查，等确认后再安装；component.json 可以在最外层或唯一的子文件夹里
  stage(zip: string): ComponentPreview {
    this.discard();
    const tmp = path.join(this.deps.dir, STAGING);
    try {
      fs.mkdirSync(tmp, { recursive: true });
      execFileSync(TAR, ['-xf', zip, '-C', tmp], { windowsHide: true });
      let root = tmp;
      if (!fs.existsSync(path.join(root, MANIFEST))) {
        const [sub, ...more] = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory());
        if (!sub || more.length || !fs.existsSync(path.join(root, sub.name, MANIFEST))) throw new Error(`包里没有 ${MANIFEST}`);
        root = path.join(root, sub.name);
      }
      const r = ComponentStore.load(root, false);
      if (!r.ok) throw new Error(r.errors.join('；'));
      const m = r.item.manifest;
      for (const [k, p] of [['page', m.page], ['panel.page', m.panel?.page], ['window', m.window], ['main', m.main], ['icon', m.icon], ['skin', m.skin]] as const) {
        if (p !== undefined && !fs.existsSync(path.join(root, p))) throw new Error(`${k} 指向的 ${p} 不在包里`);
      }
      const old = ComponentStore.read(path.join(this.deps.dir, m.id));
      this.staged = { root, manifest: m };
      return { ok: true, manifest: m, code: r.item.code, replaces: old.ok ? old.manifest.version : null };
    } catch (e) {
      this.discard();
      return { ok: false, error: errorText(e) };
    }
  }

  // 选好、等确认的组件 id
  get stagedId(): string | null {
    return this.staged?.manifest.id ?? null;
  }

  discard(): void {
    this.staged = null;
    fs.rmSync(path.join(this.deps.dir, STAGING), { recursive: true, force: true });
  }

  // 装上选好的组件：同 id 的旧版本先删掉；返回装上的清单
  install(): Manifest {
    const s = this.staged;
    if (!s) throw new Error('没有选好的组件');
    try {
      const dest = path.join(this.deps.dir, s.manifest.id);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(s.root, dest, { recursive: true });
      return s.manifest;
    } finally {
      this.discard();
    }
  }

  // 卸载组件目录里的组件(不动开发文件夹和 npm 包)；id 格式不对的不拼成路径
  remove(id: string): void {
    if (!isComponentId(id)) throw new Error('没有这个组件');
    const dir = path.join(this.deps.dir, id);
    if (!ComponentStore.read(dir).ok && !this.bad.some(b => b.folder === dir)) throw new Error('没有这个组件');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 删掉组件目录里一个不能加载的文件夹
  removeBroken(folder: string): void {
    const b = this.bad.find(x => x.folder === folder && !x.dev);
    if (!b) throw new Error('没有这个文件夹');
    fs.rmSync(folder, { recursive: true, force: true });
  }
}
