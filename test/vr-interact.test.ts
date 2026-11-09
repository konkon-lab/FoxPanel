import test from 'node:test';
import assert from 'node:assert/strict';
import type { DisplayOptions } from '@konkon-lab/foxpanel-sdk';
import { dotPose, position, ray, rayQuad, settlePose, type Mat34 } from '../components/steamvr/src/geometry.ts';
import {
  blockPriority, driver, IDLE, letGo, pickHit, reaches, step, type Command, type Frame, type Grab, type HandAim, type HandIndex, type HandInput, type PanelShape,
  type State,
} from '../components/steamvr/src/interact.ts';

const near = (a: readonly number[], b: readonly number[], eps = 1e-9): void => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => assert.ok(Math.abs(v - (b[i] ?? NaN)) < eps, `[${a.join(', ')}] ≠ [${b.join(', ')}]`));
};

// 不带旋转、放在 (x, y, z) 的姿态：面板的正面朝 +Z，手的射线朝 -Z
const at = (x: number, y: number, z: number): Mat34 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
const shifted = (m: Mat34, dx: number, dy: number, dz: number): Mat34 => {
  const r: Mat34 = [...m];
  r[3] += dx;
  r[7] += dy;
  r[11] += dz;
  return r;
};

const LEFT = 0;
const RIGHT = 1;
const DT = 0.01;                        // 一帧的秒数
const K = 1 - Math.exp(-0.25);          // 跟手时一帧(10 毫秒)靠近目标的比例：时间常数 0.04 秒

// 一块面板：交互用的形状加纹理的像素
interface Panel extends PanelShape {
  width: number;
  height: number;
}
// 甲：中心在 (0, 1.3, -1)，宽 0.8 米、800×400 像素；乙：在甲右边 1 米，宽 0.4 米、400×400 像素。都留在空间里，抓取延迟 0.15 秒
const first = (): Panel => ({
  id: 'a.one', pose: at(0, 1.3, -1), meters: 0.8, minMeters: 0.4, maxMeters: 1.6, aspect: 0.5, movable: true, anchor: 'world', grabDelay: 0.15, width: 800, height: 400,
});
const second = (): Panel => ({
  id: 'a.two', pose: at(1, 1.3, -1), meters: 0.4, minMeters: 0.1, maxMeters: 2, aspect: 1, movable: true, anchor: 'world', grabDelay: 0.15, width: 400, height: 400,
});
// 手在面板前 0.5 米，正对着世界里的 (x, y)
const hand = (x: number, y: number): Mat34 => at(x, y, -0.5);

// 逐帧喂输入：手的姿态和按键由测试改，求交用真的 rayQuad(附着在一只手上的面板不和这只手求交)，面板的姿态和宽度照算出的指令改
class Bench {
  state: State = IDLE;
  panels: Panel[];
  tips: [Mat34 | null, Mat34 | null] = [null, null];
  click: [boolean, boolean] = [false, false];
  grab: [boolean, boolean] = [false, false];
  options: Frame['options'] = { stretch: true, snap: false };
  private was = { click: [false, false], grab: [false, false] };

  constructor(...panels: Panel[]) {
    this.panels = panels;
  }

  aim(h: HandIndex): HandAim {
    const tip = this.tips[h];
    if (!tip) return { tip, hits: this.panels.map(() => null) };
    const { source, dir } = ray(tip);
    return { tip, hits: this.panels.map(p => (reaches(h, p) ? rayQuad(source, dir, p.pose, p.meters, p.width, p.height) : null)) };
  }

  // 各块面板的抓取延迟都设成 seconds 秒
  delay(seconds: number): void {
    for (const p of this.panels) p.grabDelay = seconds;
  }

  // 走一帧，返回算出的指令
  frame(keys: Partial<Pick<Frame, 'toggle' | 'quick1' | 'quick2'>> = {}, dt = DT): Command[] {
    const input = (h: HandIndex): HandInput => ({
      ...this.aim(h),
      click: { down: this.click[h], changed: this.click[h] !== this.was.click[h] },
      grab: { down: this.grab[h], changed: this.grab[h] !== this.was.grab[h] },
    });
    const frame: Frame = { panels: this.panels, hands: [input(0), input(1)], options: this.options, toggle: false, quick1: false, quick2: false, ...keys };
    this.was = { click: [...this.click], grab: [...this.grab] };
    const { state, commands } = step(this.state, frame, dt);
    this.state = state;
    for (const c of commands) {
      const panel = 'id' in c ? this.panels.find(p => p.id === c.id) : undefined;
      if (!panel) continue;
      if (c.kind === 'pose' || c.kind === 'drop') panel.pose = c.pose;
      if (c.kind === 'meters' || c.kind === 'resize') panel.meters = c.meters;
    }
    return commands;
  }

  // 走 n 帧，返回最后一帧的指令
  frames(n: number): Command[] {
    let last: Command[] = [];
    for (let i = 0; i < n; i++) last = this.frame();
    return last;
  }

  panel(id: string): Panel {
    const p = this.panels.find(x => x.id === id);
    assert.ok(p);
    return p;
  }

  // 一只手这时握着的面板
  grabbing(h: HandIndex): Grab | null {
    return this.state.hands[h].grab;
  }
}

// 指令里发给页面的指点事件，写成「面板 事件 x,y」
const events = (commands: readonly Command[]): string[] => commands.flatMap(c => {
  if (c.kind !== 'input') return [];
  const e = c.event;
  if (e.kind === 'move') return [`${c.id} move ${e.x},${e.y}${e.held ? ' held' : ''}`];
  if (e.kind === 'down' || e.kind === 'up') return [`${c.id} ${e.kind} ${e.x},${e.y}`];
  return [`${c.id} ${e.kind}`];
});
// 指令里两只手的圆点：在哪(位置)，不显示是 null
const dots = (commands: readonly Command[]): (number[] | null)[] => [LEFT, RIGHT].map(h => {
  const c = commands.find(x => x.kind === 'dot' && x.hand === h);
  return c?.kind === 'dot' && c.pose ? position(c.pose) : null;
});
// 指令里记进布局的：松手的位置、缩放后的宽度
const saved = (commands: readonly Command[]): string[] => commands.flatMap(c => (c.kind === 'drop' ? [`drop ${c.id}`] : c.kind === 'resize' ? [`resize ${c.id} ${c.meters}`] : []));
const kinds = (commands: readonly Command[]): string[] => commands.filter(c => c.kind !== 'dot').map(c => c.kind);

// ---------- 指 ----------

test('指：射线打在哪块面板的正面，就给那块发移动、圆点贴在落点上；移开时发移出、圆点不显示', () => {
  const b = new Bench(first());
  assert.deepEqual(kinds(b.frame()), []);                       // 没有手
  b.tips[RIGHT] = hand(0.1, 1.2);
  const c = b.frame();
  assert.deepEqual(events(c), ['a.one move 500,300']);          // 向右 0.1 米是 100 像素，向下 0.1 米是 100 像素
  assert.deepEqual(dots(c)[LEFT], null);
  near(dots(c)[RIGHT] ?? [], position(dotPose(at(0, 1.3, -1), [0.1, 1.2, -1])));
  assert.equal(b.state.hands[RIGHT].over, 'a.one');
  assert.deepEqual(events(b.frame()), ['a.one move 500,300']);  // 没动也每帧发
  b.tips[RIGHT] = hand(0.6, 1.3);                               // 面板右边之外
  const out = b.frame();
  assert.deepEqual([events(out), dots(out)], [['a.one leave'], [null, null]]);
  assert.deepEqual([b.state.hands[RIGHT].over, b.state.drivers], [null, {}]);
  assert.deepEqual(events(b.frame()), []);                      // 移出只发一次
});

test('指：两块面板前后叠着时取近的一块；从背面打到的不算；没有指尖时不指着任何面板', () => {
  const back = { ...second(), id: 'a.back', pose: at(0, 1.3, -1.2), meters: 0.8 };
  const b = new Bench(back, first());
  b.tips[LEFT] = hand(0, 1.3);
  assert.deepEqual(events(b.frame()), ['a.one move 400,200']);
  assert.equal(pickHit(b.aim(LEFT)), 1);
  // 手转到面板背后朝外指(射线朝 +Z)：两块都从背面打到
  b.tips[LEFT] = [-1, 0, 0, 0, 0, 1, 0, 1.3, 0, 0, -1, -1.5];
  assert.equal(pickHit(b.aim(LEFT)), -1);
  assert.deepEqual(events(b.frame()), ['a.one leave']);
  // 求交有结果、指尖却没有的一只手不算指着
  assert.equal(pickHit({ tip: null, hits: [null, rayQuad([0, 1.3, -0.5], [0, 0, -1], at(0, 1.3, -1), 0.8, 800, 400)] }), -1);
});

test('从甲移到乙：给甲发移出，再给乙发移动', () => {
  const b = new Bench(first(), second());
  b.tips[RIGHT] = hand(0.3, 1.3);
  assert.deepEqual(events(b.frame()), ['a.one move 700,200']);
  b.tips[RIGHT] = hand(0.9, 1.3);
  assert.deepEqual(events(b.frame()), ['a.one leave', 'a.two move 100,200']);
  assert.deepEqual(b.state.drivers, { 'a.two': RIGHT });
  b.tips[RIGHT] = hand(0.3, 1.3);
  assert.deepEqual(events(b.frame()), ['a.two leave', 'a.one move 700,200']);
});

// ---------- 点 ----------

test('点：扳机按下发按下，按着时移动带着按键，松开发抬起；没指着面板时扳机不发事件', () => {
  const b = new Bench(first());
  b.click[LEFT] = true;
  assert.deepEqual(events(b.frame()), []);                      // 没有手
  b.click[LEFT] = false;
  b.frame();
  b.tips[LEFT] = hand(-0.2, 1.3);
  b.frame();
  b.click[LEFT] = true;
  assert.deepEqual(events(b.frame()), ['a.one move 200,200', 'a.one down 200,200']);   // 这一帧的移动在按下之前
  assert.equal(b.state.hands[LEFT].press, 'a.one');
  b.tips[LEFT] = hand(-0.1, 1.3);
  assert.deepEqual(events(b.frame()), ['a.one move 300,200 held']);
  b.click[LEFT] = false;
  assert.deepEqual(events(b.frame()), ['a.one move 300,200 held', 'a.one up 300,200']);
  assert.equal(b.state.hands[LEFT].press, null);
  assert.deepEqual(events(b.frame()), ['a.one move 300,200']);
});

test('点：扳机在面板外按下再移上来，移动不带按键，松开也不发抬起', () => {
  const b = new Bench(first());
  b.tips[LEFT] = hand(-0.6, 1.3);
  b.click[LEFT] = true;
  b.frame();
  b.tips[LEFT] = hand(0, 1.3);
  assert.deepEqual(events(b.frame()), ['a.one move 400,200']);
  b.click[LEFT] = false;
  assert.deepEqual(events(b.frame()), ['a.one move 400,200']);
});

test('扳机按住滑出边缘：这只手锁在按下的那块面板上，落点夹在边上继续发移动，松开才结束', () => {
  const b = new Bench(first(), second());
  b.tips[RIGHT] = hand(0.3, 1.3);
  b.frame();
  b.click[RIGHT] = true;
  assert.deepEqual(events(b.frame()), ['a.one move 700,200', 'a.one down 700,200']);
  b.tips[RIGHT] = hand(0.5, 1.6);                               // 滑出右上角
  const outside = b.frame();
  assert.deepEqual(events(outside), ['a.one move 799,0 held']);
  near(dots(outside)[RIGHT] ?? [], position(dotPose(at(0, 1.3, -1), [0.4, 1.5, -1])));   // 圆点贴在面板的角上
  b.tips[RIGHT] = hand(0.9, 1.3);                               // 滑到乙上面：乙不收事件
  assert.deepEqual(events(b.frame()), ['a.one move 799,200 held']);
  assert.deepEqual(b.state.hands[RIGHT].over, 'a.one');
  b.tips[RIGHT] = hand(0.9, 1.0);                               // 甲的下边之外
  assert.deepEqual(events(b.frame()), ['a.one move 799,399 held']);
  b.click[RIGHT] = false;
  assert.deepEqual(events(b.frame()), ['a.one move 799,399 held', 'a.one up 799,399']);
  // 松开之后照射线真的指着哪：这里是甲乙之外
  assert.deepEqual(events(b.frame()), ['a.one leave']);
  b.tips[RIGHT] = hand(0.9, 1.3);
  assert.deepEqual(events(b.frame()), ['a.two move 100,200']);
});

test('扳机按住时手的姿态没了：留在最近的落点、圆点不显示，松开在那里补抬起', () => {
  const b = new Bench(first());
  b.tips[LEFT] = hand(0, 1.3);
  b.click[LEFT] = true;
  b.frame();
  b.tips[LEFT] = null;
  const lost = b.frame();
  assert.deepEqual([events(lost), dots(lost)[LEFT]], [['a.one move 400,200 held'], null]);
  b.click[LEFT] = false;                                        // 手柄关了：按键读成没按着
  assert.deepEqual(events(b.frame()), ['a.one move 400,200 held', 'a.one up 400,200']);
  assert.deepEqual(events(b.frame()), ['a.one leave']);
});

test('面板不显示了：按在它上面的扳机补抬起，指着它的手发移出，之后不给它发事件', () => {
  const b = new Bench(first(), second());
  b.tips[LEFT] = hand(0, 1.3);
  b.tips[RIGHT] = hand(1, 1.3);
  b.click[LEFT] = true;
  b.frame();
  b.frame();
  b.panels = [second()];                                        // 甲收起了
  assert.deepEqual(events(b.frame()), ['a.one up 400,200', 'a.one leave', 'a.two move 200,200']);
  assert.deepEqual([b.state.hands[LEFT], b.state.drivers], [{ over: null, at: null, press: null, grab: null }, { 'a.two': RIGHT }]);
  b.panels = [];                                                // 乙也收起了：只是指着
  assert.deepEqual(events(b.frame()), ['a.two leave']);
  assert.deepEqual(events(b.frame()), []);
  b.click[LEFT] = false;
  assert.deepEqual(events(b.frame()), []);
});

// ---------- 一块面板只听一只手 ----------

test('驱动手：先指上来的那只；另一只手的圆点照常显示但不发移动，驱动手移开后轮到它', () => {
  const b = new Bench(first());
  b.tips[RIGHT] = hand(0.2, 1.3);
  b.frame();
  assert.equal(driver(b.state, 'a.one'), RIGHT);
  b.tips[LEFT] = hand(-0.2, 1.3);
  const both = b.frame();
  assert.deepEqual(events(both), ['a.one move 600,200']);
  assert.ok(dots(both)[LEFT] && dots(both)[RIGHT]);
  assert.equal(b.state.hands[LEFT].over, 'a.one');
  b.tips[RIGHT] = hand(0.2, 1.8);                               // 右手移开
  assert.deepEqual(events(b.frame()), ['a.one leave']);         // 左手这一帧排在右手前面，还不是驱动手
  assert.deepEqual(events(b.frame()), ['a.one move 200,200']);
  assert.equal(driver(b.state, 'a.one'), LEFT);
  assert.equal(driver(b.state, 'a.none'), null);
});

test('驱动手的切换：另一只手按下扳机时换手，两只手交替点同一块面板各发各的按下和抬起', () => {
  const b = new Bench(first());
  b.tips[LEFT] = hand(-0.2, 1.3);
  b.frame();
  b.tips[RIGHT] = hand(0.2, 1.3);
  b.frame();
  const tap = (h: HandIndex): string[] => {
    b.click[h] = true;
    const down = events(b.frame());
    b.click[h] = false;
    return [...down, '|', ...events(b.frame())];
  };
  assert.deepEqual(tap(RIGHT), ['a.one move 200,200', 'a.one move 600,200', 'a.one down 600,200', '|', 'a.one move 600,200 held', 'a.one up 600,200']);
  assert.equal(driver(b.state, 'a.one'), RIGHT);
  assert.deepEqual(events(b.frame()), ['a.one move 600,200']);  // 左手不发了
  assert.deepEqual(tap(LEFT), ['a.one move 200,200', 'a.one down 200,200', '|', 'a.one move 200,200 held', 'a.one up 200,200']);
  assert.equal(driver(b.state, 'a.one'), LEFT);
  assert.deepEqual(tap(RIGHT), ['a.one move 200,200', 'a.one move 600,200', 'a.one down 600,200', '|', 'a.one move 600,200 held', 'a.one up 600,200']);
});

test('驱动手的切换：前一只手还按着时另一只手按下，替前一只补抬起后换手；前一只之后松开时不发抬起', () => {
  const b = new Bench(first());
  b.tips[LEFT] = hand(-0.2, 1.3);
  b.tips[RIGHT] = hand(0.2, 1.3);
  b.frame();
  b.click[LEFT] = true;
  b.frame();
  b.click[RIGHT] = true;                                        // 左手还没松
  assert.deepEqual(events(b.frame()), ['a.one move 200,200 held', 'a.one up 200,200', 'a.one move 600,200', 'a.one down 600,200']);
  assert.deepEqual([b.state.hands[LEFT].press, b.state.hands[RIGHT].press, driver(b.state, 'a.one')], [null, 'a.one', RIGHT]);
  b.click[LEFT] = false;
  assert.deepEqual(events(b.frame()), ['a.one move 600,200 held']);
  b.click[RIGHT] = false;
  assert.deepEqual(events(b.frame()), ['a.one move 600,200 held', 'a.one up 600,200']);
  // 同一帧里一只松开、另一只按下：抬起在前
  b.click[RIGHT] = true;
  b.frame();
  b.click[RIGHT] = false;
  b.click[LEFT] = true;
  assert.deepEqual(events(b.frame()), ['a.one up 600,200', 'a.one move 200,200', 'a.one down 200,200']);
});

test('两只手各指一块面板：各发各的，互不影响', () => {
  const b = new Bench(first(), second());
  b.tips[LEFT] = hand(0, 1.3);
  b.tips[RIGHT] = hand(1, 1.3);
  assert.deepEqual(events(b.frame()), ['a.one move 400,200', 'a.two move 200,200']);
  b.click[LEFT] = true;
  b.click[RIGHT] = true;
  assert.deepEqual(events(b.frame()), ['a.one move 400,200', 'a.one down 400,200', 'a.two move 200,200', 'a.two down 200,200']);
  assert.deepEqual(b.state.drivers, { 'a.one': LEFT, 'a.two': RIGHT });
});

test('驱动手：不是驱动手的那只手移开面板不发移出，驱动手不变', () => {
  const b = new Bench(first());
  b.tips[LEFT] = hand(-0.1, 1.3);
  b.frame();
  b.tips[RIGHT] = hand(0.1, 1.3);
  b.frame();
  assert.equal(driver(b.state, 'a.one'), LEFT);
  b.tips[RIGHT] = hand(0.6, 1.3);                               // 右手移开
  assert.deepEqual(events(b.frame()), ['a.one move 300,200']);
  assert.equal(driver(b.state, 'a.one'), LEFT);
  b.tips[LEFT] = hand(-0.6, 1.3);                               // 驱动手移开才发移出
  assert.deepEqual(events(b.frame()), ['a.one leave']);
  assert.equal(driver(b.state, 'a.one'), null);
});

test('收尾：按着的扳机补抬起，指着的面板发移出；什么都没指着时没有要做的', () => {
  assert.deepEqual(letGo(IDLE), []);
  const b = new Bench(first(), second());
  b.tips = [hand(0, 1.3), hand(1, 1.3)];
  b.frame();
  assert.deepEqual(events(letGo(b.state)), ['a.one leave', 'a.two leave']);
  b.click[RIGHT] = true;
  b.frame();
  assert.deepEqual(events(letGo(b.state)), ['a.two up 200,200', 'a.one leave', 'a.two leave']);
  // 按住滑出边缘：在夹住的落点上抬起
  b.tips[RIGHT] = hand(1.5, 1.3);
  b.frame();
  assert.deepEqual(events(letGo(b.state)), ['a.two up 399,200', 'a.one leave', 'a.two leave']);
});

// ---------- 抓 ----------

test('抓取延迟：握把在面板上按住满 0.15 秒面板才跟手；没指着面板、面板锁着时抓不起来；没满延迟就移开不算', () => {
  const b = new Bench(first());
  const start = b.panel('a.one').pose;
  b.tips[RIGHT] = hand(0.6, 1.3);                               // 没指着
  b.grab[RIGHT] = true;
  b.frames(30);
  assert.equal(b.grabbing(RIGHT), null);
  b.grab[RIGHT] = false;
  b.frame();

  b.tips[RIGHT] = hand(0.1, 1.3);
  b.frame();
  b.grab[RIGHT] = true;
  b.frames(10);                                                 // 0.09 秒
  assert.equal(b.grabbing(RIGHT)?.grip, null);
  b.tips[RIGHT] = hand(0.2, 1.3);                               // 手在面板上动：面板不跟
  assert.deepEqual(kinds(b.frames(3)), ['input']);
  assert.equal(b.panel('a.one').pose, start);
  b.frames(7);                                                  // 满 0.15 秒：记下这一刻面板相对指尖的位置
  assert.ok(b.grabbing(RIGHT)?.grip);
  near(b.panel('a.one').pose, start);                           // 抓起来的那一刻不跳
  b.tips[RIGHT] = hand(0.3, 1.35);
  b.frame();
  near(b.panel('a.one').pose, shifted(start, 0.1 * K, 0.05 * K, 0));   // 一帧走时间常数 0.04 秒的指数平滑的一步

  // 没满延迟就移开：不算，移回来也不接着数
  const c = new Bench(first());
  c.tips[LEFT] = hand(0, 1.3);
  c.frame();
  c.grab[LEFT] = true;
  c.frames(5);
  c.tips[LEFT] = hand(0.6, 1.3);
  c.frame();
  assert.equal(c.grabbing(LEFT), null);
  c.tips[LEFT] = hand(0, 1.3);
  c.frames(40);
  assert.equal(c.grabbing(LEFT), null);

  // 没满延迟就松开：不算松手，不记位置
  const early = new Bench(first());
  early.options = { ...early.options, snap: true };
  early.tips[LEFT] = hand(0, 1.3);
  early.frame();
  early.grab[LEFT] = true;
  early.frames(5);
  early.grab[LEFT] = false;
  assert.deepEqual(saved(early.frame()), []);
  assert.equal(early.grabbing(LEFT), null);

  // 锁着的面板
  const d = new Bench({ ...first(), movable: false });
  d.tips[LEFT] = hand(0, 1.3);
  d.frame();
  d.grab[LEFT] = true;
  d.frames(40);
  assert.equal(d.grabbing(LEFT), null);
});

test('抓取延迟选「无」时握把按下就抓起来；选 0.4 秒时要按住 0.4 秒', () => {
  const b = new Bench(first());
  b.delay(0);
  b.tips[LEFT] = hand(0, 1.3);
  b.frame();
  b.grab[LEFT] = true;
  b.frame();
  assert.ok(b.grabbing(LEFT)?.grip);

  const c = new Bench(first());
  c.delay(0.4);
  c.tips[LEFT] = hand(0, 1.3);
  c.frame();
  c.grab[LEFT] = true;
  c.frames(35);
  assert.equal(c.grabbing(LEFT)?.grip, null);
  c.frames(10);
  assert.ok(c.grabbing(LEFT)?.grip);
});

// 用「无」延迟抓起一块面板
function grabbed(...panels: Panel[]): Bench {
  const b = new Bench(...panels);
  b.delay(0);
  b.tips[RIGHT] = hand(0.1, 1.3);
  b.frame();
  b.grab[RIGHT] = true;
  b.frame();
  return b;
}

test('抓：抓起来以后射线离开面板也不脱手，面板平滑地跟着手走；松开时留在原地、位置记进布局，之后不跟', () => {
  const b = grabbed(first());
  const start = at(0, 1.3, -1);
  b.tips[RIGHT] = hand(1.1, 1.35);                              // 手一下挪出 1 米，射线早就不在面板上了
  const c = b.frame();
  assert.deepEqual(kinds(c), ['input', 'pose']);                // 移出，加这一帧的姿态
  near(b.panel('a.one').pose, shifted(start, K, 0.05 * K, 0));
  b.frames(200);
  near(b.panel('a.one').pose, shifted(start, 1, 0.05, 0), 1e-6);
  b.grab[RIGHT] = false;
  const rest = b.panel('a.one').pose;
  const released = b.frame();
  assert.deepEqual(saved(released), ['drop a.one']);
  assert.equal(released.find(x => x.kind === 'drop')?.pose, rest);   // 不吸正时就是松手那一刻的姿态
  assert.equal(b.grabbing(RIGHT), null);
  b.tips[RIGHT] = hand(0, 1.3);
  assert.deepEqual(saved(b.frames(5)), []);
  assert.equal(b.panel('a.one').pose, rest);
});

test('抓：手转动时面板绕着手转，保持抓起来时相对指尖的位置', () => {
  const b = grabbed(first());
  // 手原地绕 Y 转 180°
  b.tips[RIGHT] = [-1, 0, 0, 0.1, 0, 1, 0, 1.3, 0, 0, -1, -0.5];
  b.frames(300);
  // 抓起来时面板在指尖前方 0.5 米、左边 0.1 米；转过去以后在手的另一侧
  near(b.panel('a.one').pose, [-1, 0, 0, 0.2, 0, 1, 0, 1.3, 0, 0, -1, 0], 1e-6);
});

test('抓：面板不显示了就放开，不记位置；抓着时面板被锁上算松手，位置记进布局', () => {
  const b = grabbed(first());
  b.panels = [];
  assert.deepEqual(saved(b.frame()), []);
  assert.equal(b.grabbing(RIGHT), null);

  const c = grabbed(first());
  c.panel('a.one').movable = false;
  assert.deepEqual(saved(c.frame()), ['drop a.one']);
  assert.equal(c.grabbing(RIGHT), null);
});

test('两只手各抓一块：各移各的', () => {
  const b = new Bench(first(), second());
  b.delay(0);
  b.tips[LEFT] = hand(0, 1.3);
  b.tips[RIGHT] = hand(1, 1.3);
  b.frame();
  b.grab = [true, true];
  b.frame();
  b.tips[LEFT] = hand(0, 1.5);
  b.tips[RIGHT] = hand(1.3, 1.3);
  b.frames(200);
  near(b.panel('a.one').pose, at(0, 1.5, -1), 1e-6);
  near(b.panel('a.two').pose, at(1.3, 1.3, -1), 1e-6);
  assert.equal(b.state.stretch, null);
  b.grab = [false, true];
  assert.deepEqual(saved(b.frame()), ['drop a.one']);
  b.grab = [false, false];
  assert.deepEqual(saved(b.frame()), ['drop a.two']);
});

// ---------- 缩放 ----------

// 两只手相距 0.4 米抓住同一块面板
function stretching(panel: Panel = first(), left = hand(-0.2, 1.3), right = hand(0.2, 1.3)): Bench {
  const b = new Bench(panel);
  b.delay(0);
  b.tips = [left, right];
  b.frame();
  b.grab = [true, true];
  b.frame();
  return b;
}

test('缩放：两只手抓住同一块时宽度按两手距离的比例变，夹在这块面板的最小和最大宽度之间；缩放中不记进布局', () => {
  const b = stretching();
  assert.deepEqual(b.state.stretch, { id: 'a.one', d0: 0.4, w0: 0.8 });
  near([b.panel('a.one').meters], [0.8]);
  b.tips[RIGHT] = hand(0.4, 1.3);                               // 0.6 米
  assert.deepEqual(saved(b.frame()), []);
  near([b.panel('a.one').meters], [1.2]);
  b.tips[RIGHT] = hand(1, 1.3);                                 // 1.2 米
  b.frame();
  assert.equal(b.panel('a.one').meters, 1.6);
  b.tips[RIGHT] = hand(-0.1, 1.3);                              // 0.1 米
  assert.deepEqual(saved(b.frame()), []);
  assert.equal(b.panel('a.one').meters, 0.4);
});

test('缩放：两手距离不到 0.05 米时按 0.05 米算——两只手靠在一起抓住时宽度不跳', () => {
  const b = stretching(first(), hand(-0.01, 1.3), hand(0.01, 1.3));   // 起点两手 0.02 米
  near([b.panel('a.one').meters], [0.8]);
  b.tips[RIGHT] = hand(0.03, 1.3);                              // 0.04 米：还在下限里，宽度不变
  b.frame();
  near([b.panel('a.one').meters], [0.8]);
  b.tips[RIGHT] = hand(0.065, 1.3);                             // 0.075 米：按 0.075 / 0.05 放大
  b.frame();
  near([b.panel('a.one').meters], [1.2]);
  b.tips[RIGHT] = hand(0.01, 1.3);                              // 合回 0.02 米：回到起点的宽度
  b.frame();
  near([b.panel('a.one').meters], [0.8]);
});

test('缩放：面板跟着左手走', () => {
  const b = stretching();
  b.tips = [hand(-0.2, 1.4), hand(0.5, 1.3)];
  b.frames(200);
  near(b.panel('a.one').pose, at(0, 1.4, -1), 1e-6);
});

test('缩放结束：任一只手松开，宽度取整到厘米记进布局；还抓着的手重新记相对位置，面板不跳，接着能拖', () => {
  const b = stretching();
  const start = at(0, 1.3, -1);
  b.tips[RIGHT] = hand(0.3333, 1.3);                            // 两手 0.5333 米
  b.frames(3);
  near([b.panel('a.one').meters], [1.0666]);
  near(b.panel('a.one').pose, start);
  b.grab[LEFT] = false;                                         // 左手松开，右手还抓着
  const ended = b.frame();
  assert.deepEqual(saved(ended), ['resize a.one 1.07']);        // 没有 drop：右手还抓着
  assert.equal(b.state.stretch, null);
  near(b.panel('a.one').pose, start);                           // 不向右手抓起来时的相对位置靠
  b.frames(20);
  near(b.panel('a.one').pose, start);
  b.tips[RIGHT] = hand(0.3333, 1.4);                            // 右手接着拖
  b.frames(200);
  near(b.panel('a.one').pose, shifted(start, 0, 0.1, 0), 1e-6);
  b.grab[RIGHT] = false;
  assert.deepEqual(saved(b.frame()), ['drop a.one']);
});

test('缩放结束：两只手同一帧松开只记一次宽度、一次位置；取整后的宽度不出最小和最大', () => {
  const b = stretching();
  b.tips[RIGHT] = hand(0.4, 1.3);
  b.frame();
  b.grab = [false, false];
  assert.deepEqual(saved(b.frame()), ['resize a.one 1.2', 'drop a.one']);
  assert.deepEqual(saved(b.frames(3)), []);

  const c = stretching({ ...first(), minMeters: 0.404 });
  c.tips[RIGHT] = hand(-0.19, 1.3);                             // 两手 0.01 米：夹到最小 0.404，取整到厘米是 0.40，比最小还小
  c.frame();
  c.grab = [false, false];
  assert.deepEqual(saved(c.frame()), ['resize a.one 0.404', 'drop a.one']);
  const d = stretching({ ...first(), maxMeters: 1.006 });       // 夹到最大 1.006，取整到厘米是 1.01，比最大还大
  d.tips[RIGHT] = hand(1, 1.3);
  d.frame();
  d.grab = [false, false];
  assert.deepEqual(saved(d.frame()), ['resize a.one 1.006', 'drop a.one']);
});

test('缩放中面板不显示了：不记宽度，状态清掉', () => {
  const b = stretching();
  b.tips[RIGHT] = hand(0.4, 1.3);
  b.frame();
  b.panels = [];
  assert.deepEqual(saved(b.frame()), []);
  assert.deepEqual([b.state.stretch, b.grabbing(LEFT), b.grabbing(RIGHT)], [null, null, null]);
});

test('双手缩放关着时：第二只手抓不了已经被抓着的面板，宽度不变', () => {
  const b = new Bench(first());
  b.options = { stretch: false, snap: false };
  b.delay(0);
  b.tips = [hand(-0.2, 1.3), hand(0.2, 1.3)];
  b.frame();
  b.grab[LEFT] = true;
  b.frame();
  b.grab[RIGHT] = true;
  b.frame();
  assert.equal(b.grabbing(RIGHT), null);
  b.tips[RIGHT] = hand(0.4, 1.3);
  b.frames(5);
  assert.deepEqual([b.panel('a.one').meters, b.state.stretch], [0.8, null]);
});

// ---------- 吸正 ----------

test('松手吸正：开着时松手的位置是吸正过的，关着时原样', () => {
  // 面板侧倾 5°：绕自己的法线(Z)转
  const c = Math.cos(5 * Math.PI / 180);
  const s = Math.sin(5 * Math.PI / 180);
  const tilted: Mat34 = [c, -s, 0, 0, s, c, 0, 1.3, 0, 0, 1, -1];
  for (const snap of [true, false]) {
    const b = grabbed({ ...first(), pose: tilted });
    b.options = { ...b.options, snap };
    b.grab[RIGHT] = false;
    const drop = b.frame().find(x => x.kind === 'drop');
    assert.ok(drop);
    near(drop.pose, snap ? settlePose(tilted) : tilted, 1e-12);
    near(settlePose(tilted), at(0, 1.3, -1), 1e-12);
  }
});

// ---------- 挡游戏按键 ----------

test('挡游戏按键的条件：有手指着面板的正面、有扳机按在面板上没松开、有手抓着面板；都不成立时不挡', () => {
  const b = new Bench(first());
  b.delay(0);
  const block = (): boolean => blockPriority(b.state, [b.aim(LEFT), b.aim(RIGHT)]);
  assert.equal(block(), false);
  b.tips[LEFT] = hand(0.6, 1.3);                                // 面板外
  assert.equal(block(), false);
  b.tips[LEFT] = [-1, 0, 0, 0, 0, 1, 0, 1.3, 0, 0, -1, -1.5];   // 指着背面
  assert.equal(block(), false);
  b.tips[LEFT] = hand(0, 1.3);                                  // 指着正面
  assert.equal(block(), true);
  b.frame();
  // 扳机按住滑出去：还挡
  b.click[LEFT] = true;
  b.frame();
  b.tips[LEFT] = hand(0.6, 1.3);
  assert.equal(block(), true);
  b.click[LEFT] = false;
  b.frame();
  assert.equal(block(), false);
  // 抓着面板、射线移开了：还挡
  b.tips[LEFT] = hand(0, 1.3);
  b.frame();
  b.grab[LEFT] = true;
  b.frame();
  b.tips[LEFT] = hand(2, 1.3);
  b.frame();
  assert.equal(block(), true);
  b.grab[LEFT] = false;
  b.frames(2);
  assert.equal(block(), false);
  // 握把按在面板外：不抓，也不挡
  b.grab[LEFT] = true;
  b.frame();
  assert.equal(block(), false);
  // 面板收起了：不挡
  b.tips[LEFT] = hand(0, 1.3);
  b.panels = [];
  b.frame();
  assert.equal(block(), false);
});

// ---------- 开关键 ----------

test('总开关键和两个快捷位键：按下的那一帧各出一条指令', () => {
  const b = new Bench(first());
  assert.deepEqual(kinds(b.frame({ toggle: true })), ['toggleAll']);
  assert.deepEqual(b.frame({ quick1: true, quick2: true }).filter(c => c.kind === 'quick'), [{ kind: 'quick', slot: 1 }, { kind: 'quick', slot: 2 }]);
  assert.deepEqual(kinds(b.frame()), []);
});

test('状态不可变：一帧算出新的状态，给进去的那份不动', () => {
  const b = new Bench(first());
  const frozen: DisplayOptions = { blockInput: true, grabDelay: 0, stretch: true, snap: true, recenter: 'away' };
  b.options = frozen;
  b.tips[LEFT] = hand(0, 1.3);
  const before = b.state;
  b.frame();
  assert.deepEqual(before, IDLE);
  assert.notEqual(b.state, before);
  assert.deepEqual(IDLE, { hands: [{ over: null, at: null, press: null, grab: null }, { over: null, at: null, press: null, grab: null }], drivers: {}, stretch: null });
});

// ---------- 附着的面板 ----------

// 丙：附着在左手上的小面板，在甲的位置，宽 0.2 米、200×100 像素，抓取延迟 0.4 秒
const worn = (): Panel => ({
  id: 'a.worn', pose: at(0, 1.3, -1), meters: 0.2, minMeters: 0.1, maxMeters: 0.6, aspect: 0.5, movable: true, anchor: 'left', grabDelay: 0.4, width: 200, height: 100,
});

test('哪只手够得着：附着在一只手上的面板这只手够不着，另一只手够得着；附着在头显上的、留在空间里的两只手都够得着', () => {
  const table = (['world', 'head', 'left', 'right'] as const).map(anchor => [anchor, reaches(LEFT, { anchor }), reaches(RIGHT, { anchor })]);
  assert.deepEqual(table, [['world', true, true], ['head', true, true], ['left', false, true], ['right', true, false]]);
});

test('附着在左手上的面板：左手的射线正对着它也不算指着——没有事件、没有圆点、不挡游戏按键、扳机和握把都不起作用；右手照常指和点', () => {
  const b = new Bench(worn());
  b.tips[LEFT] = hand(0, 1.3);
  const idle = b.frame();
  assert.deepEqual([events(idle), dots(idle)], [[], [null, null]]);
  assert.equal(pickHit(b.aim(LEFT)), -1);
  assert.equal(blockPriority(b.state, [b.aim(LEFT), b.aim(RIGHT)]), false);
  b.click[LEFT] = true;
  b.grab[LEFT] = true;
  assert.deepEqual(kinds(b.frames(60)), []);
  assert.deepEqual([b.state.hands[LEFT].press, b.grabbing(LEFT)], [null, null]);
  b.click[LEFT] = false;
  b.grab[LEFT] = false;
  b.frame();

  b.tips[RIGHT] = hand(0.05, 1.3);
  assert.deepEqual(events(b.frame()), ['a.worn move 150,50']);
  assert.equal(blockPriority(b.state, [b.aim(LEFT), b.aim(RIGHT)]), true);
  b.click[RIGHT] = true;
  assert.deepEqual(events(b.frame()), ['a.worn move 150,50', 'a.worn down 150,50']);
  b.click[RIGHT] = false;
  assert.deepEqual(events(b.frame()), ['a.worn move 150,50 held', 'a.worn up 150,50']);
  assert.equal(driver(b.state, 'a.worn'), RIGHT);
});

test('抓取延迟各块面板各算各的：同一帧里一块要按住 0.4 秒，另一块 0.15 秒', () => {
  const b = new Bench({ ...worn(), anchor: 'head' }, second());
  b.tips = [hand(1, 1.3), hand(0, 1.3)];                        // 左手指着乙，右手指着丙
  b.frame();
  b.grab = [true, true];
  b.frames(17);                                                 // 按住 0.16 秒
  assert.ok(b.grabbing(LEFT)?.grip);
  assert.equal(b.grabbing(RIGHT)?.grip, null);
  b.frames(21);                                                 // 0.37 秒
  assert.equal(b.grabbing(RIGHT)?.grip, null);
  b.frames(5);                                                  // 0.42 秒
  assert.ok(b.grabbing(RIGHT)?.grip);
});

test('附着的面板松手不吸正：侧倾 5° 的面板，留在空间里的吸正，附着在头显或手上的原样记下', () => {
  const c = Math.cos(5 * Math.PI / 180);
  const s = Math.sin(5 * Math.PI / 180);
  const tilted: Mat34 = [c, -s, 0, 0, s, c, 0, 1.3, 0, 0, 1, -1];
  for (const anchor of ['world', 'head', 'left'] as const) {
    const b = new Bench({ ...first(), pose: tilted, anchor });
    b.options = { stretch: true, snap: true };
    b.delay(0);
    b.tips[RIGHT] = hand(0.1, 1.3);
    b.frame();
    b.grab[RIGHT] = true;
    b.frame();
    b.grab[RIGHT] = false;
    const drop = b.frame().find(x => x.kind === 'drop');
    assert.ok(drop, anchor);
    near(drop.pose, anchor === 'world' ? at(0, 1.3, -1) : tilted, 1e-12);
  }
});

test('双手缩放附着在左手上的面板：右手抓着它时左手的握把按满抓取延迟也算抓着(不用指着；这里延迟设成 0)，宽度按两手距离变；任一只手松开时记宽度，都松开才记位置', () => {
  const b = new Bench(worn());
  b.delay(0);
  b.tips = [hand(-0.3, 1.3), hand(0.05, 1.3)];                  // 左手的射线打不到面板上；两手 0.35 米
  b.frame();
  b.grab[LEFT] = true;                                          // 没有手抓着它：左手按握把不起作用
  b.frames(3);
  assert.equal(b.grabbing(LEFT), null);
  b.grab[LEFT] = false;
  b.frame();
  b.grab[RIGHT] = true;
  b.frame();
  assert.ok(b.grabbing(RIGHT)?.grip);
  b.grab[LEFT] = true;
  b.frame();
  assert.ok(b.grabbing(LEFT)?.grip);
  assert.equal(b.state.stretch?.id, 'a.worn');
  near([b.state.stretch?.d0 ?? 0, b.state.stretch?.w0 ?? 0], [0.35, 0.2]);
  b.tips[RIGHT] = hand(0.4, 1.3);                               // 两手 0.7 米：宽度翻倍
  assert.deepEqual(saved(b.frame()), []);
  near([b.panel('a.worn').meters], [0.4]);
  b.grab[RIGHT] = false;                                        // 右手松开：记宽度，左手还带着它
  assert.deepEqual(saved(b.frame()), ['resize a.worn 0.4']);
  assert.ok(b.grabbing(LEFT)?.grip);
  b.grab[LEFT] = false;
  assert.deepEqual(saved(b.frame()), ['drop a.worn']);

  // 右手还在抓取延迟里(没抓起来)：左手按握把不算
  const slow = new Bench(worn());
  slow.tips = [hand(-0.3, 1.3), hand(0.05, 1.3)];
  slow.frame();
  slow.grab[RIGHT] = true;
  slow.frames(5);
  slow.grab[LEFT] = true;
  slow.frame();
  assert.deepEqual([slow.grabbing(RIGHT)?.grip, slow.grabbing(LEFT)], [null, null]);

  // 双手缩放关着，或面板不是附着在左手上：左手不指着就抓不上
  for (const patch of [{ stretch: false, anchor: 'left' }, { stretch: true, anchor: 'head' }, { stretch: true, anchor: 'world' }] as const) {
    const c = new Bench({ ...worn(), anchor: patch.anchor });
    c.options = { stretch: patch.stretch, snap: false };
    c.delay(0);
    c.tips = [hand(-0.3, 1.3), hand(0.05, 1.3)];
    c.frame();
    c.grab[RIGHT] = true;
    c.frame();
    c.grab[LEFT] = true;
    c.frame();
    assert.deepEqual([c.grabbing(RIGHT)?.id, c.grabbing(LEFT), c.state.stretch], ['a.worn', null, null], JSON.stringify(patch));
  }
  // 面板锁上的那一帧左手按下握把：加不进来
  const shut = new Bench(worn());
  shut.delay(0);
  shut.tips = [hand(-0.3, 1.3), hand(0.05, 1.3)];
  shut.frame();
  shut.grab[RIGHT] = true;
  shut.frame();
  shut.panel('a.worn').movable = false;
  shut.grab[LEFT] = true;
  shut.frame();
  assert.deepEqual([shut.grabbing(LEFT), shut.grabbing(RIGHT), shut.state.stretch], [null, null, null]);
  // 附着在右手上的面板反过来：左手抓着，右手按握把加进来
  const mirror = new Bench({ ...worn(), anchor: 'right' });
  mirror.delay(0);
  mirror.tips = [hand(0.05, 1.3), hand(0.4, 1.3)];
  mirror.frame();
  mirror.grab[LEFT] = true;
  mirror.frame();
  mirror.grab[RIGHT] = true;
  mirror.frame();
  assert.deepEqual([mirror.grabbing(LEFT)?.id, mirror.grabbing(RIGHT)?.id, mirror.state.stretch?.id], ['a.worn', 'a.worn', 'a.worn']);
});

test('自己手上的面板加进双手缩放也要按满它的抓取延迟(0.4 秒)：没按满就松开不缩放、不记宽度，按满才开始；另一只手在这期间放开就不算', () => {
  const b = new Bench(worn());
  b.tips = [hand(-0.3, 1.3), hand(0.05, 1.3)];                  // 左手的射线打不到面板上；两手 0.35 米
  b.frame();
  b.grab[RIGHT] = true;
  b.frames(45);
  assert.ok(b.grabbing(RIGHT)?.grip);
  b.grab[LEFT] = true;
  b.frames(30);                                                 // 左手按住 0.29 秒
  assert.deepEqual([b.grabbing(LEFT), b.state.stretch], [{ id: 'a.worn', held: b.grabbing(LEFT)?.held ?? NaN, grip: null }, null]);
  near([b.grabbing(LEFT)?.held ?? NaN], [0.29]);
  b.tips[RIGHT] = hand(0.4, 1.3);                               // 右手挪开：面板跟着右手，宽度不变
  assert.deepEqual(kinds(b.frames(5)), ['pose']);
  b.grab[LEFT] = false;                                         // 没按满就松开
  assert.deepEqual(saved(b.frame()), []);
  assert.deepEqual([b.grabbing(LEFT), b.state.stretch, b.panel('a.worn').meters], [null, null, 0.2]);

  b.grab[LEFT] = true;
  b.frames(39);                                                 // 0.38 秒
  assert.deepEqual([b.grabbing(LEFT)?.grip, b.state.stretch], [null, null]);
  b.frames(3);                                                  // 0.41 秒
  assert.ok(b.grabbing(LEFT)?.grip);
  assert.equal(b.state.stretch?.id, 'a.worn');
  const d0 = b.state.stretch?.d0 ?? NaN;
  b.tips[LEFT] = hand(-0.3 - d0, 1.3);                          // 两手的距离翻倍：宽度翻倍
  b.frame();
  near([b.panel('a.worn').meters], [0.4]);
  b.grab = [false, false];
  assert.deepEqual(saved(b.frame()), ['resize a.worn 0.4', 'drop a.worn']);

  // 左手还没按满，右手放开了：左手不算按在它上面
  const late = new Bench(worn());
  late.tips = [hand(-0.3, 1.3), hand(0.05, 1.3)];
  late.frame();
  late.grab[RIGHT] = true;
  late.frames(45);
  late.grab[LEFT] = true;
  late.frames(20);
  late.grab[RIGHT] = false;
  assert.deepEqual(saved(late.frame()), ['drop a.worn']);
  late.frames(40);                                              // 左手还按着，早就过了 0.4 秒
  assert.deepEqual([late.grabbing(LEFT), late.grabbing(RIGHT), late.state.stretch, late.panel('a.worn').meters], [null, null, null, 0.2]);
});
