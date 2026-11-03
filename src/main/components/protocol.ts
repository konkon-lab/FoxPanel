// fox:// 协议：fox://host/<路径> 是页面宿主(dist/host)，fox://<面板 id>.panel/<路径> 也是页面宿主的文件，
// 每块面板的页面用自己的主机名，各是一个源(localStorage、IndexedDB 互不相通，也和主窗口分开)；
// fox://component/<id>/<路径> 是组件文件。组件从 fox://component 加载、跨源导入，响应都带 CORS 头；
// 组件文件的响应另带一条内容安全策略：被当成文档或 worker 加载时只能取 fox:// 的东西，不能联网。

import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import { isComponentId } from '../../shared/manifest.ts';
import { insideDir } from './store.ts';

const SCHEME = 'fox';
const PANEL_SUFFIX = '.panel';   // 面板页面的主机名：面板 id 加这个后缀
// 组件文件的响应带的内容安全策略(只在文件被当成文档或 worker 加载时起作用，import 的模块、样式、图片不受影响)
export const COMPONENT_CSP = "default-src fox:; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'";

// 一个 fox:// 地址指的是什么：页面宿主目录下的文件，或一个组件包里的文件；rel 是相对路径(还没查有没有越出目录)
export type FoxTarget = { kind: 'host'; rel: string } | { kind: 'component'; id: string; rel: string };

// 解析 fox:// 地址；不是 fox:// 地址、带用户名、主机名不认识、路径不是合格的编码时为 null。地址里 ? 和 # 后面的部分不看
export function resolveFox(address: string): FoxTarget | null {
  let url: URL;
  let rel: string;
  try {
    url = new URL(address);
    rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:` || url.username || url.password) return null;
  const host = url.host;
  if (host === 'host') return { kind: 'host', rel };
  if (host.endsWith(PANEL_SUFFIX) && isComponentId(host.slice(0, -PANEL_SUFFIX.length))) return { kind: 'host', rel };
  if (host !== 'component') return null;
  const slash = rel.indexOf('/');
  return slash > 0 ? { kind: 'component', id: rel.slice(0, slash), rel: rel.slice(slash + 1) } : null;
}

// app ready 之前调用
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

const notFound = (): Response => new Response('not found', { status: 404 });

// 处理 fox:// 请求：hostRoot 是页面宿主的目录，component 把组件 id 和包内路径对到文件(没有或越出组件目录时为 null)
export function handleScheme(hostRoot: string, component: (id: string, rel: string) => string | null): void {
  protocol.handle(SCHEME, async req => {
    const target = resolveFox(req.url);
    const file = !target ? null : target.kind === 'host' ? insideDir(hostRoot, target.rel) : component(target.id, target.rel);
    if (!file) return notFound();
    const res = await net.fetch(pathToFileURL(file).toString()).catch(() => null);
    if (!res?.ok) return notFound();
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'no-store');
    if (target?.kind === 'component') headers.set('Content-Security-Policy', COMPONENT_CSP);
    return new Response(res.body, { status: 200, headers });
  });
}
