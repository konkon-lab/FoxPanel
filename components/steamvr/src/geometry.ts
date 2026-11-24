// SteamVR 的 3×4 仿射矩阵(行主序存储：前 3 列是 X/Y/Z 轴，第 4 列是位置)、面板的摆放、射线和面板的求交。
// 悬浮窗口是以变换原点为中心的矩形：宽沿 +X，高沿 +Y，正面朝 +Z。全是纯函数。

import type { DisplayOptions, PanelAnchor, PanelSpawn } from '@konkon-lab/foxpanel-sdk';

export type Mat34 = [number, number, number, number, number, number, number, number, number, number, number, number];
export type Vec3 = [number, number, number];
type Quat = [number, number, number, number];   // x y z w

export const IDENTITY: Mat34 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

const DEG = Math.PI / 180;                // 一度(弧度)

// 附着的面板在设备上的默认位置。设备自己的坐标：前方 -Z，上方 +Y，右方 +X；手柄握着时手腕在 +Z 一侧，
// 手背在左手柄的 -X、右手柄的 +X 一侧
const HEAD_AHEAD = 0.45;                  // 附着在头显上：面板在眼睛前方多远(米)
const HEAD_BELOW = 0.25;                  // 附着在头显上：面板比眼睛低多少(米)
const HAND_BACK = 0.05;                   // 附着在手上：面板离手柄原点朝手背一侧多远(米)
const HAND_WRIST = 0.12;                  // 附着在手上：面板离手柄原点朝手腕一侧多远(米)
const HAND_TILT = 40 * DEG;               // 附着在手上：面板的正面从朝手背转向手柄上方多少(弧度)，抬手看表时朝向眼睛
const GLANCE_ENTER = 40 * DEG;            // 抬手才显示：面板正面的法线和面板到眼睛的方向夹角小于这么多时显示出来(弧度)
const GLANCE_LEAVE = 50 * DEG;            // 抬手才显示：夹角大于这么多时隐藏(弧度)；两者之间保持原样

// 按下标取元素，越界当 0
const el = (m: readonly number[], i: number): number => m[i] ?? 0;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

const UNIT_EPSILON = 1e-9;   // 长度不到这么多的向量当零向量，没有方向

// 单位向量；零向量时为 fallback
function unit(v: Vec3, fallback: Vec3 = [0, 0, -1]): Vec3 {
  const n = length(v);
  return n > UNIT_EPSILON ? scale(v, 1 / n) : fallback;
}

// 矩阵乘 a·b：作用在点 p 上等于 a(b(p))
export function mul(a: Mat34, b: Mat34): Mat34 {
  const r = new Array<number>(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      let v = j === 3 ? el(a, i * 4 + 3) : 0;
      for (let k = 0; k < 3; k++) v += el(a, i * 4 + k) * el(b, k * 4 + j);
      r[i * 4 + j] = v;
    }
  }
  return r as Mat34;
}

// 刚体变换的逆
export function invert(m: Mat34): Mat34 {
  const p = position(m);
  const r = new Array<number>(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 4 + j] = el(m, j * 4 + i);
    r[i * 4 + 3] = -(el(m, i) * p[0] + el(m, 4 + i) * p[1] + el(m, 8 + i) * p[2]);
  }
  return r as Mat34;
}

// 变换作用在点上
export function applyPoint(m: Mat34, p: readonly number[]): Vec3 {
  const d = applyDir(m, p);
  return [d[0] + m[3], d[1] + m[7], d[2] + m[11]];
}

// 变换作用在方向上：只转不移
export function applyDir(m: Mat34, d: readonly number[]): Vec3 {
  const row = (r: number): number => el(m, r * 4) * el(d, 0) + el(m, r * 4 + 1) * el(d, 1) + el(m, r * 4 + 2) * el(d, 2);
  return [row(0), row(1), row(2)];
}

const RIGID_EPSILON = 1e-3;   // 刚体变换的旋转部分：各行的长度离 1、两行的点积离 0 不超过这么多

// 是不是刚体变换：12 个有限的数，旋转部分的三行都是单位长、两两垂直、右手系(没有缩放和镜像)
export function isRigid(m: readonly number[]): m is Mat34 {
  if (m.length !== 12 || !m.every(Number.isFinite)) return false;
  const rows: Vec3[] = [0, 4, 8].map(i => [el(m, i), el(m, i + 1), el(m, i + 2)]);
  const [x, y, z] = rows;
  if (!x || !y || !z) return false;
  if (rows.some(r => Math.abs(length(r) - 1) > RIGID_EPSILON)) return false;
  if (Math.abs(dot(x, y)) > RIGID_EPSILON || Math.abs(dot(y, z)) > RIGID_EPSILON || Math.abs(dot(z, x)) > RIGID_EPSILON) return false;
  return dot(cross(x, y), z) > 0;
}

// 两个 Y 朝上的坐标系之间的变换(只有绕 Y 轴的转动和平移)：同一个姿态在一个坐标系里是 from、在另一个里是 to，
// 给出把前一个坐标系里的东西换到后一个里的变换。转角取 to·from⁻¹ 里绕 Y 轴的那一份，平移让 from 的位置正好落在 to 的位置上
export function levelBetween(to: Mat34, from: Mat34): Mat34 {
  const m = mul(to, invert(from));
  const yaw = Math.atan2(m[2] - m[8], m[0] + m[10]);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const turn: Mat34 = [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0];
  const p = sub(position(to), applyDir(turn, position(from)));
  return [c, 0, s, p[0], 0, 1, 0, p[1], -s, 0, c, p[2]];
}

export const position = (m: Mat34): Vec3 => [m[3], m[7], m[11]];
export const axis = (m: Mat34, c: 0 | 1 | 2): Vec3 => [el(m, c), el(m, 4 + c), el(m, 8 + c)];
// 设备的前方是 -Z
const forward = (m: Mat34): Vec3 => scale(axis(m, 2), -1);

const compose = (x: Vec3, y: Vec3, z: Vec3, p: Vec3): Mat34 => [x[0], y[0], z[0], p[0], x[1], y[1], z[1], p[1], x[2], y[2], z[2], p[2]];

const VERTICAL_Y = 0.999;   // 朝向的 Y 分量超过这么多算竖直朝上或朝下，「上」取 -Z

// 放在 pos、正面(+Z)朝向 target，保持水平(不侧倾)
export function facing(pos: Vec3, target: Vec3): Mat34 {
  const z = unit(sub(target, pos), [0, 0, 1]);
  const up: Vec3 = Math.abs(z[1]) > VERTICAL_Y ? [0, 0, -1] : [0, 1, 0];
  const x = unit(cross(up, z), [1, 0, 0]);
  return compose(x, cross(z, x), z, pos);
}

// ---------- 附着 ----------

// pose 相对附着对象的变换：anchor 是附着对象的姿态，留在空间里的面板是 IDENTITY
export const relativeTo = (pose: Mat34, anchor: Mat34): Mat34 => mul(invert(anchor), pose);

// 相对附着对象的变换 → 面板空间里的姿态
export const anchorPose = (anchor: Mat34, relative: Mat34): Mat34 => mul(anchor, relative);

// 附着的面板还没摆过时相对设备的变换(设备自己的坐标)。
// 头显：前方 HEAD_AHEAD、下方 HEAD_BELOW，正面朝向眼睛。
// 手柄：朝手背一侧 HAND_BACK、朝手腕一侧 HAND_WRIST，正面从朝手背转向手柄上方 HAND_TILT，文字的右方是抬手看表时人的右方
export function anchorDefault(anchor: Exclude<PanelAnchor, 'world'>): Mat34 {
  if (anchor === 'head') return facing([0, -HEAD_BELOW, -HEAD_AHEAD], [0, 0, 0]);
  const side = anchor === 'left' ? -1 : 1;   // 手背在 X 轴的哪一侧
  const z: Vec3 = [side * Math.cos(HAND_TILT), Math.sin(HAND_TILT), 0];
  const x: Vec3 = [0, 0, side];
  return compose(x, cross(z, x), z, [side * HAND_BACK, 0, HAND_WRIST]);
}

// 抬手才显示的面板这一刻显示不显示：面板正面的法线和面板到眼睛的方向夹角小于 GLANCE_ENTER 时显示，大于 GLANCE_LEAVE 时隐藏，
// 两者之间照上一次的结果 was。panel 是面板在面板空间里的姿态；眼睛就在面板的原点上时照 was
export function glanceShown(head: Mat34, panel: Mat34, was: boolean): boolean {
  const to = sub(position(head), position(panel));
  if (length(to) <= UNIT_EPSILON) return was;
  const cos = dot(axis(panel, 2), unit(to));
  if (cos > Math.cos(GLANCE_ENTER)) return true;
  return cos < Math.cos(GLANCE_LEAVE) ? false : was;
}

// ---------- 摆放 ----------

// 清单的 spawn 各自的出现位置，以头的水平朝向为准：ahead = 离眼睛多远(米，水平方向)，below = 比眼睛低多少(米)，
// turn = 方向从正前方向右转多少(弧度)
const SPAWNS: Record<PanelSpawn, { ahead: number; below: number; turn: number }> = {
  front: { ahead: 0.65, below: 0.05, turn: 0 },
  low: { ahead: 0.55, below: 0.3, turn: 0 },
  side: { ahead: 0.65, below: 0.05, turn: 35 * DEG },
};
const ARRANGE_CLEAR = 0.2;                // 出现位置这么近(米)以内已有别的面板就换一个方向
const ARRANGE_TURNS = [0, 35, -35, 70, -70].map(deg => deg * DEG);   // 依次试的方向：从出现位置的方向再向右转多少(弧度，负的向左)
const ARRANGE_STEP = 0.05;                // 各个方向都占了时，在第一个方向上朝头每块错开的距离(米)
const REACH_ANGLE = 50 * Math.PI / 180;   // 面板方向偏离视线不超过这么多才算在面前(弧度)
const REACH_NEAR = 0.2;                   // 面板离眼睛的最近距离(米)
const REACH_FAR = 1.5;                    // 面板离眼睛的最远距离(米)

// 头的水平朝向
function heading(head: Mat34): Vec3 {
  const f = forward(head);
  return unit([f[0], 0, f[2]], [0, 0, -1]);
}

// 出现位置所在的水平圆弧(以头为圆心)上的一点：方向从 spawn 的方向再向右转 turn 弧度，朝头退 back 米
function spot(head: Mat34, spawn: PanelSpawn, turn: number, back: number): Vec3 {
  const { ahead, below, turn: base } = SPAWNS[spawn];
  const f = heading(head);
  const right: Vec3 = [-f[2], 0, f[0]];
  const dir = add(scale(f, Math.cos(base + turn)), scale(right, Math.sin(base + turn)));
  return add(add(position(head), scale(dir, ahead - back)), [0, -below, 0]);
}

// 一块面板放到面前：清单的 spawn 给的位置，正面朝向眼睛。others 是别的面板的位置：出现位置 ARRANGE_CLEAR 以内已有面板时
// 依次试 ARRANGE_TURNS 里的方向；都占了就在第一个方向上朝头每块错开 ARRANGE_STEP，最近到离眼睛 REACH_NEAR(水平方向)
export function arrange(head: Mat34, spawn: PanelSpawn, others: readonly Vec3[]): Mat34 {
  const eye = position(head);
  const free = (p: Vec3, clear: number): boolean => others.every(o => distance(o, p) >= clear);
  for (const turn of ARRANGE_TURNS) {
    const p = spot(head, spawn, turn, 0);
    if (free(p, ARRANGE_CLEAR)) return facing(p, eye);
  }
  const steps = Math.max(1, Math.round((SPAWNS[spawn].ahead - REACH_NEAR) / ARRANGE_STEP));
  for (let k = 1; k < steps; k++) {
    const p = spot(head, spawn, 0, k * ARRANGE_STEP);
    if (free(p, ARRANGE_STEP / 2)) return facing(p, eye);
  }
  return facing(spot(head, spawn, 0, steps * ARRANGE_STEP), eye);
}

// 面板还在面前：距离合适、在视线附近、正面朝着人
export function withinReach(panel: Mat34, head: Mat34): boolean {
  const eye = position(head);
  const to = sub(position(panel), eye);
  const d = length(to);
  if (d < REACH_NEAR || d > REACH_FAR) return false;
  if (dot(unit(to), unit(forward(head))) < Math.cos(REACH_ANGLE)) return false;
  return dot(axis(panel, 2), scale(to, -1)) > 0;
}

// 面板由不显示变成显示时(总开关恢复、快捷位键、打开、重连后重建都算)这一块要不要重新放到面前：还没摆过的(pose 为 null)要；
// rule 是 always 时每次都要，away 时不在面前(离眼睛太近或太远、偏离视线太多、背对着人)才要，never 时不要
export function needsArrange(rule: DisplayOptions['recenter'], pose: Mat34 | null, head: Mat34): boolean {
  if (!pose || rule === 'always') return true;
  return rule === 'away' && !withinReach(pose, head);
}

// ---------- 松手吸正 ----------

const SETTLE_ROLL = 8 * DEG;   // 侧倾(绕面板法线的转角)不超过这么多时归零(弧度)
const SETTLE_TILT = 6 * DEG;   // 面板离竖直(法线离水平面)不超过这么多时立正(弧度)

// 松手吸正：侧倾在 SETTLE_ROLL 以内归零，离竖直在 SETTLE_TILT 以内立正，位置和朝哪个方向不变；
// 两样都不用动、或面板平躺着(法线竖直，没有侧倾可言)时给回同一份
export function settlePose(pose: Mat34): Mat34 {
  const z = axis(pose, 2);
  if (Math.abs(z[1]) > VERTICAL_Y) return pose;
  const level = unit(cross([0, 1, 0], z), [1, 0, 0]);              // 不侧倾时的 X 轴：水平、垂直于法线
  const x = axis(pose, 0);
  const roll = Math.atan2(dot(x, cross(z, level)), dot(x, level));
  const upright = Math.abs(Math.asin(z[1])) <= SETTLE_TILT;
  const flat = Math.abs(roll) <= SETTLE_ROLL;
  if ((!upright || z[1] === 0) && (!flat || roll === 0)) return pose;
  const zn = upright ? unit([z[0], 0, z[2]], z) : z;
  const r = flat ? 0 : roll;
  const xn = add(scale(level, Math.cos(r)), scale(cross(zn, level), Math.sin(r)));
  return compose(xn, cross(zn, xn), zn, position(pose));
}

// ---------- 平滑 ----------

// 旋转部分 → 四元数
function toQuat(m: Mat34): Quat {
  const [a, b, c, , d, e, f, , g, h, i] = m;
  const t = a + e + i;
  if (t > 0) {
    const s = 2 * Math.sqrt(t + 1);
    return [(h - f) / s, (c - g) / s, (d - b) / s, s / 4];
  }
  if (a > e && a > i) {
    const s = 2 * Math.sqrt(1 + a - e - i);
    return [s / 4, (b + d) / s, (c + g) / s, (h - f) / s];
  }
  if (e > i) {
    const s = 2 * Math.sqrt(1 + e - a - i);
    return [(b + d) / s, s / 4, (f + h) / s, (c - g) / s];
  }
  const s = 2 * Math.sqrt(1 + i - a - e);
  return [(c + g) / s, (f + h) / s, s / 4, (d - b) / s];
}

// 四元数(归一化后)和位置 → 矩阵
function fromQuat(q: Quat, p: Vec3): Mat34 {
  const n = Math.hypot(...q) || 1;
  const [x, y, z, w] = q.map(v => v / n) as Quat;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), p[0],
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), p[1],
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), p[2],
  ];
}

const SLERP_LINEAR_COS = 0.9995;   // 两个旋转夹角的余弦超过这么多时按线性插值(球面插值的分母接近 0)

// 四元数球面插值，走较短的一侧
function slerp(a: Quat, b: Quat, t: number): Quat {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = cos < 0 ? (b.map(v => -v) as Quat) : b;
  cos = Math.abs(cos);
  if (cos > SLERP_LINEAR_COS) return a.map((v, i) => v + ((bb[i] ?? 0) - v) * t) as Quat;
  const theta = Math.acos(cos);
  const s = Math.sin(theta);
  const ka = Math.sin((1 - t) * theta) / s;
  const kb = Math.sin(t * theta) / s;
  return a.map((v, i) => v * ka + (bb[i] ?? 0) * kb) as Quat;
}

// 向目标靠近：时间常数 tau 秒的指数平滑，位置线性、旋转球面插值
export function approach(cur: Mat34, target: Mat34, dt: number, tau: number): Mat34 {
  const k = 1 - Math.exp(-Math.max(0, dt) / tau);
  const p = position(cur);
  const q = position(target);
  return fromQuat(slerp(toQuat(cur), toQuat(target), k), add(p, scale(sub(q, p), k)));
}

// 只保留旋转和位置(不含缩放)
export const rigid = (m: Mat34): Mat34 => fromQuat(toQuat(m), position(m));

// ---------- 指针 ----------

const DOT_LIFT = 0.002;   // 圆点浮在面板正面上方的高度(米)

// 指针圆点：命中点沿面板正面抬起 DOT_LIFT，和面板同朝向
export function dotPose(panel: Mat34, point: Vec3): Mat34 {
  const n = axis(panel, 2);
  const p = add(point, scale(n, DOT_LIFT));
  return compose(axis(panel, 0), axis(panel, 1), n, p);
}

// 面板所在平面上的一点夹进面板的矩形里：面板宽 meters 米，高 = 宽 × aspect
export function clampToQuad(point: Vec3, pose: Mat34, meters: number, aspect: number): Vec3 {
  const local = sub(point, position(pose));
  const within = (v: number, size: number): number => Math.min(size / 2, Math.max(-size / 2, v));
  const x = within(dot(local, axis(pose, 0)), meters);
  const y = within(dot(local, axis(pose, 1)), meters * aspect);
  return add(position(pose), add(scale(axis(pose, 0), x), scale(axis(pose, 1), y)));
}

// 手柄指尖的射线：起点和方向(-Z)
export const ray = (m: Mat34): { source: Vec3; dir: Vec3 } => ({ source: position(m), dir: unit(forward(m)) });

// ---------- 求交 ----------

const RAY_PARALLEL = 1e-9;   // 射线方向和面板法线夹角的余弦的绝对值不到这么多算平行，没有交点
const EDGE_SLACK = 1e-9;     // 交点落在面板边上的容差(占边长的比例)

// 射线和面板所在平面的交点
export interface QuadHit {
  x: number;          // 交点在面板上的像素(原点在左上角，x 向右、y 向下)；交点在面板外时夹到最近的边上
  y: number;
  inside: boolean;    // 交点在面板的矩形里(含边)
  front: boolean;     // 射线从正面打过来
  point: Vec3;        // 交点(没有夹过)
  distance: number;   // 起点到交点(米)
}

// 射线和一块面板求交。面板是以 pose 的原点为中心的矩形：宽 meters 米沿 +X，高 = 宽 × height / width 沿 +Y，正面朝 +Z；
// width、height 是面板的像素(给纹理像素就得到纹理像素)。射线和面板平行、面板所在的平面在起点后面、尺寸不是正数时为 null
export function rayQuad(source: Vec3, dir: Vec3, pose: Mat34, meters: number, width: number, height: number): QuadHit | null {
  if (!(meters > 0) || !(width > 0) || !(height > 0) || length(dir) <= UNIT_EPSILON) return null;
  const d = unit(dir);
  const n = axis(pose, 2);
  const along = dot(d, n);
  if (Math.abs(along) < RAY_PARALLEL) return null;
  const t = dot(sub(position(pose), source), n) / along;
  if (t < 0) return null;
  const point = add(source, scale(d, t));
  const local = sub(point, position(pose));
  const u = dot(local, axis(pose, 0)) / meters + 0.5;                       // 从左到右 0–1
  const v = 0.5 - dot(local, axis(pose, 1)) / (meters * height / width);    // 从上到下 0–1
  const within = (f: number): boolean => f >= -EDGE_SLACK && f <= 1 + EDGE_SLACK;
  const pixel = (f: number, size: number): number => Math.min(size - 1, Math.max(0, Math.floor(f * size)));
  return { x: pixel(u, width), y: pixel(v, height), inside: within(u) && within(v), front: along < 0, point, distance: t };
}

// 一组求交的结果里最近的、从正面打在面板里的那个的下标；没有时为 -1。距离一样时取前面的
export function nearestHit(hits: readonly (QuadHit | null)[]): number {
  let best = -1;
  let nearest = Infinity;
  hits.forEach((hit, i) => {
    if (!hit || !hit.inside || !hit.front || hit.distance >= nearest) return;
    best = i;
    nearest = hit.distance;
  });
  return best;
}

// 悬浮窗口上的射线落点 UV → 页面像素(页面 width×height)；落在面板外或尺寸为 0 时为 null。
// SteamVR 给的 u 从左到右、v 从下到上，但 v 是按边长等于面板宽度的正方形算的：横向的面板只占中间一段，高度占比 = 高 / 宽。
// 正好落在右边、下边那条线上时给最后一列、最后一行(像素在 0 到 尺寸 − 1 之间，和 rayQuad 一样)
export function uvToPixel(u: number, v: number, width: number, height: number): { x: number; y: number } | null {
  if (!width || !height) return null;
  const r = height / width;
  const top = 0.5 + r / 2;
  const fy = (top - v) / r;
  if (u < 0 || u > 1 || fy < 0 || fy > 1) return null;
  return { x: Math.min(width - 1, Math.floor(u * width)), y: Math.min(height - 1, Math.floor(fy * height)) };
}
