import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DRAG_START_PX, findScrollBox, moveDrag, scrollAxes, startDrag, watchDrag, type DragEventType, type PressEvent, type ScrollAxes, type ScrollBox,
} from '../src/panel/drag-scroll.ts';

// 一个 300×200 的元素，内容 300×1000，滚在 top 这里
const tall = (top = 0): ScrollBox => ({ scrollLeft: 0, scrollTop: top, scrollWidth: 300, scrollHeight: 1000, clientWidth: 300, clientHeight: 200 });
// 内容 900×600，两个方向都能滚
const wide = (left = 0, top = 0): ScrollBox => ({ scrollLeft: left, scrollTop: top, scrollWidth: 900, scrollHeight: 600, clientWidth: 300, clientHeight: 200 });

const Y: ScrollAxes = { x: false, y: true };
const BOTH: ScrollAxes = { x: true, y: true };

test('拖动滚动：一个方向能滚 = overflow 是 auto 或 scroll，并且内容比元素大', () => {
  assert.deepEqual(scrollAxes(tall(), 'visible', 'auto'), { x: false, y: true });
  assert.deepEqual(scrollAxes(tall(), 'auto', 'scroll'), { x: false, y: true });
  assert.deepEqual(scrollAxes(wide(), 'scroll', 'auto'), { x: true, y: true });
  assert.deepEqual(scrollAxes(wide(), 'hidden', 'auto'), { x: false, y: true });
  for (const overflow of ['visible', 'hidden', 'clip', '']) assert.deepEqual(scrollAxes(wide(), overflow, overflow), { x: false, y: false });
  // 内容没超出：不算能滚
  const fits: ScrollBox = { scrollLeft: 0, scrollTop: 0, scrollWidth: 300, scrollHeight: 200, clientWidth: 300, clientHeight: 200 };
  assert.deepEqual(scrollAxes(fits, 'auto', 'auto'), { x: false, y: false });
});

test('拖动滚动：从按下的元素往外找第一个能滚的；没有就是 null', () => {
  // 按钮 → 列表(能竖着滚) → 卡片 → 页面(能两个方向滚)
  const parents: Record<string, string | null> = { button: 'list', list: 'card', card: 'page', page: null };
  const axes: Record<string, ScrollAxes> = { button: { x: false, y: false }, list: Y, card: { x: false, y: false }, page: BOTH };
  const find = (from: string | null) => findScrollBox(from, el => parents[el] ?? null, el => axes[el] ?? { x: false, y: false });
  assert.deepEqual(find('button'), { box: 'list', axes: Y });
  assert.deepEqual(find('list'), { box: 'list', axes: Y });
  assert.deepEqual(find('card'), { box: 'page', axes: BOTH });
  assert.equal(find(null), null);
  assert.equal(findScrollBox('button', () => null, () => ({ x: false, y: false })), null);
  // 只能横着滚的也算
  const row: ScrollAxes = { x: true, y: false };
  assert.deepEqual(findScrollBox('chip', el => (el === 'chip' ? 'row' : null), el => (el === 'row' ? row : { x: false, y: false })), { box: 'row', axes: row });
});

test('拖动滚动：按住移动不超过 8 像素不算拖动；超过之后内容跟着指针走', () => {
  assert.equal(DRAG_START_PX, 8);
  const box = tall(100);
  let drag = startDrag(box, Y, 50, 150);
  assert.deepEqual([drag.left, drag.top, drag.active], [0, 100, false]);
  // 往上挪 8 像素：还不算
  let step = moveDrag(drag, 50, 142);
  assert.deepEqual([step.to, step.drag.active, step.drag === drag], [null, false, true]);
  // 9 像素：开始拖，内容往下滚 9
  step = moveDrag(drag, 50, 141);
  assert.deepEqual([step.to, step.drag.active], [{ left: 0, top: 109 }, true]);
  drag = step.drag;
  // 拖动中回到按下的地方附近：照样跟着走(8 像素只管开始)
  step = moveDrag(drag, 50, 147);
  assert.deepEqual([step.to, step.drag === drag], [{ left: 0, top: 103 }, true]);
  // 指针往下：内容往上滚
  assert.deepEqual(moveDrag(drag, 50, 200).to, { left: 0, top: 50 });
});

test('拖动滚动：滚到头就停在头上；指针回来时内容跟着回来', () => {
  const drag = moveDrag(startDrag(tall(100), Y, 0, 500), 0, 480).drag;
  assert.deepEqual(moveDrag(drag, 0, 700).to, { left: 0, top: 0 });
  assert.deepEqual(moveDrag(drag, 0, -900).to, { left: 0, top: 800 });
  assert.deepEqual(moveDrag(drag, 0, 450).to, { left: 0, top: 150 });
});

test('拖动滚动：只沿能滚的方向算；横着拖只能竖着滚的元素不算拖动，也不动它', () => {
  const drag = startDrag(tall(100), Y, 100, 100);
  const side = moveDrag(drag, 300, 104);
  assert.deepEqual([side.to, side.drag.active], [null, false]);
  // 竖着超过了：只改竖的
  assert.deepEqual(moveDrag(drag, 300, 80).to, { left: 0, top: 120 });
  // 两个方向都能滚的：哪个方向超过都算，两个方向一起跟
  const both = startDrag(wide(200, 100), BOTH, 100, 100);
  assert.deepEqual(moveDrag(both, 80, 97).to, { left: 220, top: 103 });
  assert.deepEqual(moveDrag(both, 97, 97).to, null);
  assert.deepEqual(moveDrag(both, -900, 900).to, { left: 600, top: 0 });
});

// ---------- 接到鼠标事件上 ----------

// 假的页面元素：能不能滚看 overflow 和内容大小
interface Node extends ScrollBox {
  parent: Node | null;
  overflowX: string;
  overflowY: string;
}

// 接好拖动滚动的假页面：fire 发一个鼠标事件，返回它被拦下没有(stopImmediatePropagation)和取消默认动作没有
function page(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const listeners = new Map<DragEventType, (e: PressEvent) => void>();
  watchDrag<Node>((type, fn) => { listeners.set(type, fn); }, {
    element: target => (typeof target === 'object' && target !== null && 'parent' in target ? (target as Node) : null),
    parent: el => el.parent,
    overflow: el => el,
  });
  const fire = (type: DragEventType, target: unknown, x: number, y: number, press: { button?: number; buttons?: number } = {}): { stopped: boolean; prevented: boolean } => {
    const out = { stopped: false, prevented: false };
    listeners.get(type)?.({
      button: press.button ?? 0, buttons: press.buttons ?? 1, clientX: x, clientY: y, target,
      preventDefault: () => { out.prevented = true; },
      stopImmediatePropagation: () => { out.stopped = true; },
    });
    return out;
  };
  return { listeners, fire };
}

const node = (patch: Partial<Node> = {}): Node => ({
  scrollLeft: 0, scrollTop: 0, scrollWidth: 300, scrollHeight: 200, clientWidth: 300, clientHeight: 200, parent: null, overflowX: 'visible', overflowY: 'visible', ...patch,
});

test('拖动滚动接到页面上：四种事件都登记；在能滚的区域里按住拖过 8 像素内容跟着滚，松开后的那一次点击被拦下，再点照常', t => {
  const { listeners, fire } = page(t);
  assert.deepEqual([...listeners.keys()], ['mousedown', 'mousemove', 'mouseup', 'click']);
  const list = node({ scrollHeight: 1000, overflowY: 'auto' });
  const button = node({ parent: list });
  fire('mousedown', button, 50, 150);
  assert.deepEqual(fire('mousemove', button, 50, 145), { stopped: false, prevented: false });   // 5 像素：还不算拖
  assert.equal(list.scrollTop, 0);
  assert.deepEqual(fire('mousemove', button, 50, 90), { stopped: false, prevented: true });
  assert.equal(list.scrollTop, 60);
  fire('mouseup', button, 50, 90);
  assert.deepEqual(fire('click', button, 50, 90), { stopped: true, prevented: true });
  assert.deepEqual(fire('click', button, 50, 90), { stopped: false, prevented: false });
  // 没拖过 8 像素就松开：是一次点击
  fire('mousedown', button, 50, 150);
  fire('mousemove', button, 50, 145);
  fire('mouseup', button, 50, 145);
  assert.deepEqual(fire('click', button, 50, 145), { stopped: false, prevented: false });
  assert.equal(list.scrollTop, 60);
  // 拖完之后没有点击跟来(松开时已经不在按下的元素上)：过一轮事件循环就不拦了
  fire('mousedown', button, 50, 150);
  fire('mousemove', button, 50, 100);
  fire('mouseup', button, 50, 100);
  t.mock.timers.tick(0);
  assert.deepEqual(fire('click', button, 50, 100), { stopped: false, prevented: false });
});

test('拖动滚动接到页面上：只能横着滚的区域横着拖；不在能滚的区域里、目标不是元素时不管', t => {
  const { fire } = page(t);
  const row = node({ scrollWidth: 900, overflowX: 'scroll' });
  const chip = node({ parent: row });
  fire('mousedown', chip, 200, 20);
  assert.equal(fire('mousemove', chip, 150, 60).prevented, true);
  assert.deepEqual([row.scrollLeft, row.scrollTop], [50, 0]);
  fire('mouseup', chip, 150, 60);
  assert.equal(fire('click', chip, 150, 60).stopped, true);
  // 不在能滚的区域里
  const plain = node({ parent: node() });
  fire('mousedown', plain, 10, 10);
  assert.equal(fire('mousemove', plain, 10, 90).prevented, false);
  fire('mouseup', plain, 10, 90);
  assert.equal(fire('click', plain, 10, 90).stopped, false);
  // 目标不是元素(文档本身)
  fire('mousedown', null, 10, 10);
  assert.equal(fire('mousemove', null, 10, 90).prevented, false);
  fire('mouseup', null, 10, 90);
  assert.equal(fire('click', null, 10, 90).stopped, false);
});

test('拖动滚动接到页面上：不是左键的按下不算；移动时左键已经不按着，这一次按下就结束', t => {
  const { fire } = page(t);
  const list = node({ scrollHeight: 1000, overflowY: 'auto' });
  // 右键按下(左键这时也按着)：不从这里起一次拖动
  fire('mousedown', list, 50, 150, { button: 2, buttons: 3 });
  assert.equal(fire('mousemove', list, 50, 50, { buttons: 3 }).prevented, false);
  assert.equal(list.scrollTop, 0);
  // 别的键松开不结束左键的拖动，也不拦点击
  fire('mousedown', list, 50, 150);
  fire('mousemove', list, 50, 100);
  fire('mouseup', list, 50, 100, { button: 2 });
  assert.equal(fire('click', list, 50, 100).stopped, false);
  assert.equal(fire('mousemove', list, 50, 80).prevented, true);
  assert.equal(list.scrollTop, 70);
  fire('mouseup', list, 50, 80);
  t.mock.timers.tick(0);
  // 在页面外面松开了左键：回到页面上移动时不接着滚，之后的点击照常
  fire('mousedown', list, 50, 150);
  fire('mousemove', list, 50, 130);
  assert.equal(list.scrollTop, 90);
  assert.equal(fire('mousemove', list, 50, 60, { buttons: 0 }).prevented, false);
  assert.equal(fire('mousemove', list, 50, 40).prevented, false);
  assert.equal(list.scrollTop, 90);
  assert.equal(fire('click', list, 50, 40).stopped, false);
});

test('拖动滚动：面板页面的入口装了它', () => {
  const source = fs.readFileSync(new URL('../src/panel/main.ts', import.meta.url), 'utf8');
  assert.match(source, /^\s*installDragScroll\(\);$/m);
});
