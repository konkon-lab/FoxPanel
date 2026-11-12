<!-- 依赖图：只画正在运行的组件。力导向布局，宿主 → 分组 → 组件是实线，服务组件 → 用它的组件是虚线；
     提供服务的节点中间画「+」，分组和宿主是空心圆环。名字用组件 id 和 Group [分组]。节点可以拖动，点击不跳转；
     悬停节点高亮它往上的整条链，悬停连线高亮这条线，其余淡掉；提示框跟着鼠标 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { t } from './i18n.ts';
import { comps } from '../../_shared/window/components-service.ts';
import PageHead from '../../_shared/window/PageHead.vue';
import { Simulation, type SimLink, type SimNode } from './force.ts';

// 组件管理的分组树
const tree = computed(() => comps.value?.tree ?? []);

// 长度都是画布(viewBox)单位
const ARROW_LENGTH = 10;                // 箭头两条边的长度
const ARROW_OFFSET = 10;                // 箭头尖离目标节点圆心的距离
const ARROW_ANGLE = Math.PI / 6;        // 箭头的边和连线的夹角(弧度)
const MARGIN = 100;                     // 视口在节点外框四周留的空
// 节点各部分的大小：[平时, 悬停时]
const NODE_RADIUS = [9, 12] as const;   // 外圆半径
const RING_RADIUS = [5, 8] as const;    // 分组和宿主的内圆半径
const PLUS_ARM = [4, 5] as const;       // 「+」的臂长
const TICKS_PER_FRAME = 3;              // 每帧模拟走的步数
const REHEAT = 0.3;                     // 重建、拖动、第一次量到画布大小时把模拟的 alpha 提到的值
const TIP_HIDE_MS = 300;                // 鼠标离开后提示框收起的延时(毫秒)
// 宿主给组件的服务：页面的 i18n、overlay(要 inject)，和页面、主进程组件都有的远程服务通道 relay
const HOST_SERVICES = ['i18n', 'overlay', 'relay'];

interface GNode extends SimNode {
  key: string;
  kind: 'root' | 'group' | 'component';
  name: string;
  services: string[];
}
interface GLink extends SimLink<GNode> {
  type: 'solid' | 'dashed';
}

const box = ref<HTMLElement | null>(null);
const nodes = shallowRef<GNode[]>([]);
const links = shallowRef<GLink[]>([]);
const frame = ref(0);   // 每帧加一，让模板跟着重画
const sim = new Simulation<GNode>();

// 按组件树建图，只取正在运行的组件；已有的节点保留位置
function build(): void {
  const old = new Map(nodes.value.map(n => [n.key, n]));
  const make = (key: string, kind: GNode['kind'], name: string, services: string[] = []): GNode => {
    const n = old.get(key);
    return n ? Object.assign(n, { name, services }) : { key, kind, name, services, x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null };
  };
  const root = make('root', 'root', 'FoxPanel', HOST_SERVICES);
  const ns: GNode[] = [root];
  const ls: GLink[] = [];
  const byId = new Map<string, GNode>();
  const running = tree.value.map(g => ({ key: g.key, title: g.title, rows: g.rows.filter(r => r.active && !r.error) })).filter(g => g.rows.length);
  for (const g of running) {
    const gn = make(`g:${g.key}`, 'group', `Group [${g.title}]`);
    ns.push(gn);
    ls.push({ source: root, target: gn, weight: 1, type: 'solid' });
    for (const r of g.rows) {
      const cn = make(r.id, 'component', r.id, r.provides ?? []);
      ns.push(cn);
      byId.set(r.id, cn);
      ls.push({ source: gn, target: cn, weight: 1, type: 'solid' });
    }
  }
  for (const r of running.flatMap(g => g.rows)) {
    for (const s of r.requires ?? []) {
      const p = s.id ? byId.get(s.id) : undefined;
      const c = byId.get(r.id);
      if (p && c) ls.push({ source: p, target: c, weight: 0.2, type: 'dashed' });
    }
  }
  nodes.value = ns;
  links.value = ls;
  sim.set(ns, ls);
  sim.restart(old.size ? REHEAT : 1);
  run();
}

// 动画：模拟还在动就每帧走几步
let raf = 0;
function run(): void {
  if (raf) return;
  const step = (): void => {
    for (let i = 0; i < TICKS_PER_FRAME && sim.running; i++) sim.tick();
    frame.value++;
    raf = sim.running ? requestAnimationFrame(step) : 0;
  };
  raf = requestAnimationFrame(step);
}

// 视口：包住所有节点，四周留 MARGIN
const viewBox = computed(() => {
  void frame.value;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes.value) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  if (!Number.isFinite(minX)) return `${-MARGIN} ${-MARGIN} ${2 * MARGIN} ${2 * MARGIN}`;
  return `${minX - MARGIN} ${minY - MARGIN} ${maxX - minX + 2 * MARGIN} ${maxY - minY + 2 * MARGIN}`;
});

// 连线末端的箭头
function arrow(l: GLink): { x0: number; y0: number; x1: number; y1: number; x2: number; y2: number } {
  const th = Math.atan2(l.target.y - l.source.y, l.target.x - l.source.x);
  const x0 = l.target.x - ARROW_OFFSET * Math.cos(th);
  const y0 = l.target.y - ARROW_OFFSET * Math.sin(th);
  return {
    x0, y0,
    x1: x0 - ARROW_LENGTH * Math.cos(th - ARROW_ANGLE), y1: y0 - ARROW_LENGTH * Math.sin(th - ARROW_ANGLE),
    x2: x0 - ARROW_LENGTH * Math.cos(th + ARROW_ANGLE), y2: y0 - ARROW_LENGTH * Math.sin(th + ARROW_ANGLE),
  };
}
const drawn = computed(() => {
  void frame.value;
  return links.value.map((l, i) => ({ i, l, a: arrow(l) }));
});
// 每帧给模板一个新数组，节点跟着重画
const shown = computed(() => {
  void frame.value;
  return [...nodes.value];
});

// 高亮：悬停节点 → 它和所有往上的节点、连线；悬停连线 → 这条线和两端。
// 用 shallowRef 存节点和连线本身：下面按对象是不是同一个来比，ref 给出的响应式代理和原对象对不上
const hoverNode = shallowRef<GNode | null>(null);
const hoverLink = shallowRef<GLink | null>(null);
const sub = computed(() => {
  const ns = new Set<GNode>();
  const ls = new Set<GLink>();
  if (hoverLink.value) {
    ns.add(hoverLink.value.source).add(hoverLink.value.target);
    ls.add(hoverLink.value);
  } else if (hoverNode.value) {
    ns.add(hoverNode.value);
    let grew = true;
    while (grew) {
      grew = false;
      for (const l of links.value) {
        if (ls.has(l) || !ns.has(l.target)) continue;
        ns.add(l.source);
        ls.add(l);
        grew = true;
      }
    }
  }
  return { ns, ls, on: ns.size > 0 };
});
// 节点某一部分的大小：悬停的节点用大的
const sized = (pair: readonly [number, number], n: GNode): number => pair[hoverNode.value === n ? 1 : 0];

// 提示框：跟着鼠标
const tip = reactive({ text: '', x: 0, y: 0, show: false });
let hideTimer: ReturnType<typeof setTimeout> | undefined;
function showTip(text: string, e: MouseEvent): void {
  clearTimeout(hideTimer);
  Object.assign(tip, { text, x: e.clientX, y: e.clientY, show: true });
}
function hideTip(): void {
  hideTimer = setTimeout(() => { tip.show = false; }, TIP_HIDE_MS);
}
function onMove(e: MouseEvent): void {
  if (tip.show) Object.assign(tip, { x: e.clientX, y: e.clientY });
  onDrag(e);
}
function enterNode(n: GNode, e: MouseEvent): void {
  if (dragging?.node === n) dragging.left = false;
  hoverNode.value = n;
  const lines = [t('deps.tipComponent', { name: n.name })];
  if (n.services.length) lines.push(t('deps.tipProvides', { name: n.services.join('，') }));
  showTip(lines.join('\n'), e);
}
// 拖着的节点保持高亮；鼠标移出了它的事记下，松手时收起
function leaveNode(n: GNode): void {
  if (dragging?.node === n) {
    dragging.left = true;
    return;
  }
  hoverNode.value = null;
  hideTip();
}
function enterLink(l: GLink, e: MouseEvent): void {
  hoverLink.value = l;
  showTip(t(l.type === 'dashed' ? 'deps.tipService' : 'deps.tipCall', { from: l.source.name, to: l.target.name }), e);
}
function leaveLink(): void {
  hoverLink.value = null;
  hideTip();
}

// 拖动：按住节点移动，松开后放回布局；left = 拖动中鼠标移出了这个节点
let dragging: { node: GNode; x: number; y: number; left: boolean } | null = null;
const svg = ref<SVGSVGElement | null>(null);
function scale(): number {
  const el = svg.value;
  if (!el) return 1;
  const vb = el.viewBox.baseVal;
  return Math.max(vb.width / el.clientWidth, vb.height / el.clientHeight) || 1;
}
function startDrag(n: GNode, e: MouseEvent): void {
  dragging = { node: n, x: e.clientX, y: e.clientY, left: false };
  n.fx = n.x;
  n.fy = n.y;
  sim.alphaTarget = REHEAT;
  sim.restart(REHEAT);
  run();
}
function onDrag(e: MouseEvent): void {
  if (!dragging) return;
  const k = scale();
  const dx = e.clientX - dragging.x;
  const dy = e.clientY - dragging.y;
  dragging.node.fx = (dragging.node.fx ?? 0) + dx * k;
  dragging.node.fy = (dragging.node.fy ?? 0) + dy * k;
  dragging.x = e.clientX;
  dragging.y = e.clientY;
}
function endDrag(): void {
  if (!dragging) return;
  const { node, left } = dragging;
  node.fx = null;
  node.fy = null;
  dragging = null;
  sim.alphaTarget = 0;
  // 松手时鼠标已经不在这个节点上：收起它的高亮；提示框正显示悬停连线的内容时留着
  if (left && hoverNode.value === node) {
    hoverNode.value = null;
    if (!hoverLink.value) hideTip();
  }
}

// 画布的宽高交给模拟；只有第一次量到(刚挂上)时按它收拢一遍，之后大小变了停下的图不动
let observer: ResizeObserver | null = null;
let measured = false;
onMounted(() => {
  if (box.value) {
    observer = new ResizeObserver(([e]) => {
      if (!e) return;
      sim.resize(e.contentRect.width, e.contentRect.height);
      if (measured) return;
      measured = true;
      sim.restart(REHEAT);
      run();
    });
    observer.observe(box.value);
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', endDrag);
  build();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('mouseup', endDrag);
  cancelAnimationFrame(raf);
});
watch(tree, build);
</script>

<template>
  <div class="view">
    <page-head :title="t('deps.title')" legend="GRAPH" />
    <main ref="box" class="page" :class="{ dim: sub.on }">
      <svg ref="svg" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="t('deps.aria')">
        <g class="links">
          <g v-for="d in drawn" :key="d.i" class="link" :class="{ hot: sub.ls.has(d.l) }">
            <line :x1="d.l.source.x" :y1="d.l.source.y" :x2="d.l.target.x" :y2="d.l.target.y" class="shadow" @mouseenter="enterLink(d.l, $event)" @mouseleave="leaveLink" />
            <line :x1="d.l.source.x" :y1="d.l.source.y" :x2="d.a.x0" :y2="d.a.y0" :class="d.l.type" />
            <line :x1="d.a.x0" :y1="d.a.y0" :x2="d.a.x1" :y2="d.a.y1" />
            <line :x1="d.a.x0" :y1="d.a.y0" :x2="d.a.x2" :y2="d.a.y2" />
          </g>
        </g>
        <g class="nodes">
          <g
            v-for="n in shown" :key="n.key" class="node" :class="{ hot: sub.ns.has(n) }"
            @mouseenter="enterNode(n, $event)" @mouseleave="leaveNode(n)" @mousedown.prevent="startDrag(n, $event)"
          >
            <circle :r="sized(NODE_RADIUS, n)" :cx="n.x" :cy="n.y" />
            <circle v-if="n.kind !== 'component'" :r="sized(RING_RADIUS, n)" :cx="n.x" :cy="n.y" />
            <g v-if="n.services.length" class="service">
              <line :x1="n.x - sized(PLUS_ARM, n)" :y1="n.y" :x2="n.x + sized(PLUS_ARM, n)" :y2="n.y" />
              <line :x1="n.x" :y1="n.y - sized(PLUS_ARM, n)" :x2="n.x" :y2="n.y + sized(PLUS_ARM, n)" />
            </g>
          </g>
        </g>
      </svg>
      <div v-show="tip.show" class="tip" :style="{ left: `${tip.x}px`, top: `${tip.y}px` }">
        <div v-for="(line, i) in tip.text.split('\n')" :key="i">{{ line }}</div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.view {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.page {
  flex: 1;
  min-height: 0;
  padding: 0 24px 24px;
}
svg {
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
}
.link line {
  transition: stroke 0.3s ease, stroke-opacity 0.3s ease;
}
.link line:not(.shadow) {
  stroke: var(--text-secondary);
  stroke-opacity: 0.3;
  stroke-width: 3;
  stroke-linecap: round;
  pointer-events: none;
}
.link line.dashed {
  stroke-dasharray: 6 6;
}
.link line.shadow {
  stroke: transparent;
  stroke-width: 6;
  cursor: pointer;
}
.dim .link:not(.hot) line:not(.shadow) {
  stroke-opacity: 0.1;
}
.link.hot line:not(.shadow) {
  stroke: var(--text);
  stroke-opacity: 1;
}
.node circle {
  fill: var(--text);
  stroke: var(--page-bg);
  stroke-width: 2;
  cursor: pointer;
  transition: r 0.3s ease, opacity 0.3s ease, fill 0.3s ease;
}
.node:hover circle {
  fill: var(--text-secondary);
}
.dim .node:not(.hot) circle {
  opacity: 0.3;
}
.service line {
  stroke: var(--page-bg);
  stroke-width: 2;
  stroke-linecap: round;
  pointer-events: none;
}
.tip {
  position: fixed;
  z-index: 10;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 0 1px var(--line);
  color: var(--text);
  font-size: 13px;
  pointer-events: none;
  transform: translate(12px, 12px);
  white-space: nowrap;
}
@media (prefers-color-scheme: dark) {
  .tip {
    background: rgba(29, 31, 36, 0.85);
  }
}
</style>
