// 面板页面宿主：一块面板一页。向宿主取这一页的计划和外观，建 Cordis 根上下文和宿主服务(i18n、overlay)，
// 加载服务组件的页面部分、根组件(铺满整页)，把各插槽的部件挂进根组件里带 data-slot 的元素(元素出现了才挂)；弹层容器在根组件之上。
// 能滚动的区域按住拖动就滚(drag-scroll.ts)。计划变了由宿主让整页重载；深色和界面语言变了只换外观，不重载。

import { Context, type Plugin } from 'cordis';
import { reactive, ref, watchEffect } from 'vue';
import type { I18nService, OverlayOptions, OverlayService, PageContext, PanelPageService, PanelPart, SlotService } from '@konkon-lab/foxpanel-sdk';
import { textOf } from '../shared/manifest.ts';
import type { PageComponent, PageLook, PanelPlan } from '../shared/types.ts';
import { installClick } from './click.ts';
import { installDragScroll } from './drag-scroll.ts';
import { markFailed, mountParts, type PartMount } from './parts.ts';
import { fox, loadPlugin, watchWaiting } from './services.ts';
import './style.css';

const rootEl = document.getElementById('root')!;
const overlayEl = document.getElementById('overlay')!;

// 外观(深色、界面语言)：宿主推来新的就换。回调不返回值：返回值要过 preload 的隔离边界，响应式对象过不去
const look = reactive<PageLook>({ dark: false, locale: 'zh-Hans' });
fox.onLook(next => { Object.assign(look, next); });
// 这块面板是不是正被显示
const visible = ref(true);
fox.onVisible(on => { visible.value = on; });

const i18nService: I18nService = {
  get locale() { return look.locale; },
  text: t => textOf(t, look.locale),
};

// 弹层：每次打开建一层，盖住整个页面或根组件里指定的区域
const overlayService: OverlayService = {
  open(render, options: OverlayOptions = {}) {
    const layer = document.createElement('div');
    layer.className = 'fox-layer';
    const area = options.cover ? rootEl.querySelector<HTMLElement>(`[data-region="${options.cover}"]`) : null;
    if (area) {
      const r = area.getBoundingClientRect();
      Object.assign(layer.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    }
    let cleanup: (() => void) | void;
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      cleanup?.();
      layer.remove();
    };
    if (options.dismiss !== false) layer.addEventListener('mousedown', e => { if (e.target === layer) close(); });
    overlayEl.append(layer);
    cleanup = render(layer, close);
    return close;
  },
};

function slotService(el: HTMLElement): SlotService {
  return {
    el,
    mount(render) {
      const cleanup = render(el);
      return () => {
        cleanup?.();
        el.replaceChildren();
      };
    },
  };
}

// 组件加载失败时在它的元素里放标记
function failed(el: HTMLElement, c: PageComponent): void {
  markFailed(el, () => i18nService.text(c.name), { create: () => document.createElement('div'), follow: fn => { watchEffect(fn); } });
}

// 只有布局 JSON 的布局组件：等按键渲染服务(keys)，交给它画
function layoutPlugin(id: string, layout: unknown): Plugin {
  return {
    name: id,
    inject: ['keys', 'kb', 'overlay', 'i18n'],
    apply(ctx: PageContext) {
      ctx.effect(() => ctx.keys.mount(ctx, layout));
    },
  };
}

async function start(plan: PanelPlan): Promise<void> {
  // 皮肤：在公共样式之后加载
  if (plan.skin) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = plan.skin;
    document.head.append(link);
  }
  rootEl.style.width = `${plan.size.width}px`;
  rootEl.style.height = `${plan.size.height}px`;
  // 显示在普通窗口里时页面底下垫棋盘格，看得出哪里是透明的
  document.documentElement.classList.toggle('fox-preview', plan.preview);
  if (plan.sound) installClick();
  installDragScroll();

  // 各插槽的部件和它们的元素：根组件加载之前就建好，根组件一开始就看得到有哪些部件
  const parts: Record<string, PanelPart[]> = {};
  const mounts: PartMount<HTMLElement>[] = [];
  for (const [slot, list] of Object.entries(plan.parts)) {
    parts[slot] = list.map(component => {
      const el = document.createElement('div');
      el.className = `fox-part fox-${component.kind}`;
      el.dataset['component'] = component.id;
      mounts.push({ slot, el, component, loaded: false });
      return { id: component.id, kind: component.kind, get name() { return i18nService.text(component.name); }, ...(component.icon ? { icon: component.icon } : {}), el };
    });
  }
  const panelService: PanelPageService = {
    id: plan.id,
    width: plan.size.width,
    height: plan.size.height,
    get dark() { return look.dark; },
    setDark: on => fox.setDark(on === true),
    get visible() { return visible.value; },
    preview: plan.preview,
    parts: slot => parts[slot] ?? [],
    hide: () => fox.hide(),
  };

  const root = new Context();
  root.provide('i18n', i18nService);
  root.provide('overlay', overlayService);
  // 加载一个组件，el 是它的元素(ctx.slot)；失败时在 el 里放标记
  const load = (c: PageComponent, el: HTMLElement): Promise<void> => (
    loadPlugin(root, c, { slot: slotService(el), panel: panelService }, 'layout' in c ? layoutPlugin(c.id, c.layout) : undefined).catch(() => failed(el, c))
  );
  // 服务组件的页面部分：不占插槽，排在根组件和部件前面加载(别的组件用 inject 等它们)
  for (const c of plan.services) void load(c, document.createElement('div'));
  void load(plan.root, rootEl);
  // 部件的元素放进根组件里对应的插槽元素(元素出现了才放)，第一次放进去时加载它；一直没有插槽元素的记进运行日志
  mountParts<HTMLElement>(mounts, {
    find: slot => rootEl.querySelector<HTMLElement>(`[data-slot="${slot}"]`),
    load: (c, el) => void load(c, el),
    observe: changed => {
      const watcher = new MutationObserver(changed);
      watcher.observe(rootEl, { childList: true, subtree: true });
      return () => watcher.disconnect();
    },
    later: (fn, ms) => void setTimeout(fn, ms),
    warn: (id, text) => fox.logWrite(id, text, 'warn'),
  });
  watchWaiting(root);
}

// 根元素和弹层跟外观：界面语言写进 lang(按语言选字体)，深色加 dark 类
watchEffect(() => {
  document.documentElement.lang = look.locale;
  for (const el of [rootEl, overlayEl]) {
    el.lang = look.locale;
    el.classList.toggle('dark', look.dark);
  }
});

Object.assign(look, await fox.look());
const plan = await fox.plan();
if (plan.kind !== 'panel') throw new Error('这一页不是面板页面');
// 页面的标题是面板的名字(显示在普通窗口里时是窗口标题)
watchEffect(() => { document.title = i18nService.text(plan.root.name); });
await start(plan);
