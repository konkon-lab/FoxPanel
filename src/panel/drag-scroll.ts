// 拖动滚动：在能滚动的区域里按住左键拖动超过 DRAG_START_PX，内容就跟着指针滚(改 scrollLeft / scrollTop)，
// 这一次按下到松开不算点击(松开后的 click 事件到这里为止，页面里别的监听都收不到)。VR 里只有左键，滚动靠它；所有面板的页面都装。
// 按下那一刻就做事的控件(监听 mousedown 的)拦不住：放在能滚动的区域里的按钮要监听 click。
// 判断和计算是纯函数；接到鼠标事件上的部分在 watchDrag，installDragScroll 把它装到页面的文档上。

export const DRAG_START_PX = 8;   // 按住之后指针移动超过这么多像素(沿能滚动的方向)才算拖动

// 能滚动的元素里用到的部分
export interface ScrollBox {
  scrollLeft: number;
  scrollTop: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
}

// 一个元素哪个方向能滚
export interface ScrollAxes {
  x: boolean;
  y: boolean;
}

// 样式里的 overflow 值算不算能滚
const scrolls = (overflow: string): boolean => overflow === 'auto' || overflow === 'scroll';

// 一个元素哪个方向能滚：那个方向的 overflow 是 auto 或 scroll，并且内容比它自己大
export function scrollAxes(box: ScrollBox, overflowX: string, overflowY: string): ScrollAxes {
  return { x: scrolls(overflowX) && box.scrollWidth > box.clientWidth, y: scrolls(overflowY) && box.scrollHeight > box.clientHeight };
}

// 从按下的元素往外找第一个能滚的元素；parent 给出外面一层(没有时为 null)，axes 给出一个元素哪个方向能滚。找不到时为 null
export function findScrollBox<E>(from: E | null, parent: (el: E) => E | null, axes: (el: E) => ScrollAxes): { box: E; axes: ScrollAxes } | null {
  for (let el = from; el !== null; el = parent(el)) {
    const a = axes(el);
    if (a.x || a.y) return { box: el, axes: a };
  }
  return null;
}

// 一次按下：按在哪个能滚的元素上、按下时指针和内容的位置、已经算拖动没有
export interface Drag<E> {
  box: E;
  axes: ScrollAxes;
  x: number;        // 按下时指针的位置(页面像素)
  y: number;
  left: number;     // 按下时内容滚到哪(scrollLeft / scrollTop)
  top: number;
  active: boolean;  // 已经超过 DRAG_START_PX，在拖动
}

// 在一个能滚的元素上按下
export function startDrag<E extends ScrollBox>(box: E, axes: ScrollAxes, x: number, y: number): Drag<E> {
  return { box, axes, x, y, left: box.scrollLeft, top: box.scrollTop, active: false };
}

// 一个方向上内容该滚到哪：按下时的位置减去指针移动的量，夹在 0 和能滚的最大值之间
const scrolled = (start: number, moved: number, content: number, view: number): number => Math.min(Math.max(0, content - view), Math.max(0, start - moved));

// 按住时指针移到 (x, y)：沿能滚的方向移动超过 DRAG_START_PX 之后算拖动，内容跟着指针走。
// 返回新的状态和内容该滚到的位置；还不算拖动时位置为 null
export function moveDrag<E extends ScrollBox>(drag: Drag<E>, x: number, y: number): { drag: Drag<E>; to: { left: number; top: number } | null } {
  const dx = x - drag.x;
  const dy = y - drag.y;
  const far = (drag.axes.x && Math.abs(dx) > DRAG_START_PX) || (drag.axes.y && Math.abs(dy) > DRAG_START_PX);
  if (!drag.active && !far) return { drag, to: null };
  const { box, axes } = drag;
  return {
    drag: drag.active ? drag : { ...drag, active: true },
    to: {
      left: axes.x ? scrolled(drag.left, dx, box.scrollWidth, box.clientWidth) : drag.left,
      top: axes.y ? scrolled(drag.top, dy, box.scrollHeight, box.clientHeight) : drag.top,
    },
  };
}

// 鼠标事件里用到的部分
export interface PressEvent {
  readonly button: number;     // 哪个键：0 是左键
  readonly buttons: number;    // 这一刻按着的键，第 0 位是左键
  readonly clientX: number;
  readonly clientY: number;
  readonly target: unknown;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

// 向页面问的三样：事件的目标是不是元素、一个元素外面的那一层、一个元素算出来的 overflow
export interface DragDom<E> {
  element(target: unknown): E | null;
  parent(el: E): E | null;
  overflow(el: E): { overflowX: string; overflowY: string };
}

export type DragEventType = 'mousedown' | 'mousemove' | 'mouseup' | 'click';

// 接到鼠标事件上：listen 登记一种事件的监听(要在别的监听之前收到)，按下、移动、松开、点击都过这里
export function watchDrag<E extends ScrollBox>(listen: (type: DragEventType, fn: (e: PressEvent) => void) => void, dom: DragDom<E>): void {
  let drag: Drag<E> | null = null;
  let swallow = false;   // 刚拖动过：接下来的那一次 click 不往下传

  const axesOf = (el: E): ScrollAxes => {
    const style = dom.overflow(el);
    return scrollAxes(el, style.overflowX, style.overflowY);
  };

  listen('mousedown', e => {
    swallow = false;
    drag = null;
    if (e.button !== 0) return;
    const found = findScrollBox(dom.element(e.target), dom.parent, axesOf);
    if (found) drag = startDrag(found.box, found.axes, e.clientX, e.clientY);
  });

  listen('mousemove', e => {
    if (!drag) return;
    // 左键已经不按着(在页面外面松开的)：这一次按下结束
    if ((e.buttons & 1) === 0) {
      drag = null;
      return;
    }
    const moved = moveDrag(drag, e.clientX, e.clientY);
    drag = moved.drag;
    if (!moved.to) return;
    drag.box.scrollLeft = moved.to.left;
    drag.box.scrollTop = moved.to.top;
    e.preventDefault();
  });

  listen('mouseup', e => {
    if (e.button !== 0) return;
    swallow = drag?.active === true;
    drag = null;
    // 松开之后紧跟着的 click 已经发完：之后的点击照常
    if (swallow) setTimeout(() => { swallow = false; }, 0);
  });

  listen('click', e => {
    if (!swallow) return;
    swallow = false;
    e.stopImmediatePropagation();
    e.preventDefault();
  });
}

// 装到页面上：整个文档里按下、移动、松开、点击都先过这里(捕获阶段)
export function installDragScroll(): void {
  watchDrag((type, fn) => document.addEventListener(type, fn, true), {
    element: target => (target instanceof Element ? target : null),
    parent: el => el.parentElement,
    overflow: el => getComputedStyle(el),
  });
}
