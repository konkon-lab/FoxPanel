import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorDefault, anchorPose, applyDir, applyPoint, arrange, clampToQuad, glanceShown, IDENTITY, isRigid, levelBetween, nearestHit, needsArrange, rayQuad, relativeTo, settlePose,
  type Mat34, type QuadHit, type Vec3,
} from '../components/steamvr/src/geometry.ts';

// 这里的期望值都用下面几个直接写出来的旋转矩阵和手算的数得到，不经过被测的函数

type M3 = [number, number, number, number, number, number, number, number, number];   // 3×3 旋转矩阵，按行

const rad = (deg: number): number => deg * Math.PI / 180;
// 绕 X、Y、Z 轴转 deg 度
const rx = (deg: number): M3 => [1, 0, 0, 0, Math.cos(rad(deg)), -Math.sin(rad(deg)), 0, Math.sin(rad(deg)), Math.cos(rad(deg))];
const ry = (deg: number): M3 => [Math.cos(rad(deg)), 0, Math.sin(rad(deg)), 0, 1, 0, -Math.sin(rad(deg)), 0, Math.cos(rad(deg))];
const rz = (deg: number): M3 => [Math.cos(rad(deg)), -Math.sin(rad(deg)), 0, Math.sin(rad(deg)), Math.cos(rad(deg)), 0, 0, 0, 1];
const NONE: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// 矩阵乘 a·b
function times(a: M3, b: M3): M3 {
  const out = [...NONE] as M3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += (a[i * 3 + k] ?? 0) * (b[k * 3 + j] ?? 0);
      out[i * 3 + j] = sum;
    }
  }
  return out;
}

// 旋转 r、位置 p 的姿态
const pose = (r: M3, p: Vec3): Mat34 => [r[0], r[1], r[2], p[0], r[3], r[4], r[5], p[1], r[6], r[7], r[8], p[2]];
// 朝向 yaw、俯仰 pitch、侧倾 roll(度)的姿态：面板法线离水平面 pitch 度，绕法线转了 roll 度
const turned = (yaw: number, pitch: number, roll: number, p: Vec3 = [0.3, 1.2, -0.7]): Mat34 => pose(times(times(ry(yaw), rx(pitch)), rz(roll)), p);

function near(actual: readonly number[], expected: readonly number[], eps = 1e-9): void {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => assert.ok(Math.abs(v - (expected[i] ?? NaN)) <= eps, `第 ${i} 项 ${v}，应为 ${String(expected[i])}`));
}

const hitOf = (hit: QuadHit | null): QuadHit => hit ?? assert.fail('没有交点');

// 键盘大小的横向面板：1400×490 像素、宽 0.8 米(高 0.28 米)，正面朝 +Z，中心在 (0, 1, -1)
const WIDE = { at: pose(NONE, [0, 1, -1]), meters: 0.8, width: 1400, height: 490 };
const wide = (source: Vec3, dir: Vec3): QuadHit | null => rayQuad(source, dir, WIDE.at, WIDE.meters, WIDE.width, WIDE.height);

test('射线求交·横向面板：落点换成页面像素(左上角是原点)，带交点、距离、正反面', () => {
  // 交点在面板中心右边 0.2002 米、上面 0.07 米：x = (0.2002 / 0.8 + 0.5) × 1400 = 1050.35，y = (0.5 − 0.07 / 0.28) × 490 = 122.5
  const hit = hitOf(wide([0.2002, 1.07, 0], [0, 0, -1]));
  assert.deepEqual([hit.x, hit.y, hit.inside, hit.front], [1050, 122, true, true]);
  near(hit.point, [0.2002, 1.07, -1]);
  near([hit.distance], [1]);
  // 正中
  const center = hitOf(wide([0.0002, 0.9998, 0.5], [0, 0, -1]));
  assert.deepEqual([center.x, center.y, center.inside, center.front], [700, 245, true, true]);
  near([center.distance], [1.5]);
  // 方向不是单位向量：距离还是米
  const long = hitOf(wide([0.2002, 1.07, 0], [0, 0, -3]));
  assert.deepEqual([long.x, long.y], [1050, 122]);
  near([long.distance], [1]);
  // 面板上下边之外、还在「边长等于宽度的正方形」里(中心上面 0.3 米)：不算打在面板里
  const above = hitOf(wide([0.2002, 1.3, 0], [0, 0, -1]));
  assert.deepEqual([above.inside, above.x, above.y], [false, 1050, 0]);
});

test('射线求交·竖向面板：整块都能命中，上下两头也算', () => {
  // 200×800 像素、宽 0.2 米(高 0.8 米)，中心在 (0, 1, -1)
  const tall = (source: Vec3): QuadHit => hitOf(rayQuad(source, [0, 0, -1], pose(NONE, [0, 1, -1]), 0.2, 200, 800));
  // 中心右边 0.0501 米、上面 0.2995 米：x = (0.0501 / 0.2 + 0.5) × 200 = 150.1，y = (0.5 − 0.2995 / 0.8) × 800 = 100.5
  const top = tall([0.0501, 1.2995, 0]);
  assert.deepEqual([top.x, top.y, top.inside, top.front], [150, 100, true, true]);
  // 中心左边 0.0501 米、下面 0.3895 米：x = 49.9，y = (0.5 + 0.3895 / 0.8) × 800 = 789.5
  const bottom = tall([-0.0501, 0.6105, 0]);
  assert.deepEqual([bottom.x, bottom.y, bottom.inside], [49, 789, true]);
  // 左右出了面板
  assert.equal(tall([0.1005, 1.2995, 0]).inside, false);
});

test('射线求交·正方形面板：正中和四个角', () => {
  // 512×512 像素、宽 0.5 米，中心在原点；一个像素不到 0.001 米
  const square = (x: number, y: number): QuadHit => hitOf(rayQuad([x, y, 2], [0, 0, -1], IDENTITY, 0.5, 512, 512));
  const px = (hit: QuadHit): unknown[] => [hit.x, hit.y, hit.inside];
  assert.deepEqual(px(square(0.0005, -0.0005)), [256, 256, true]);
  assert.deepEqual(px(square(-0.2495, 0.2495)), [0, 0, true]);
  assert.deepEqual(px(square(0.2495, 0.2495)), [511, 0, true]);
  assert.deepEqual(px(square(-0.2495, -0.2495)), [0, 511, true]);
  assert.deepEqual(px(square(0.2495, -0.2495)), [511, 511, true]);
  near([square(0, 0).distance], [2]);
});

test('射线求交·背面：从背面打到也给出落点，标成不是正面', () => {
  const back = hitOf(wide([0.2002, 1.07, -2], [0, 0, 1]));
  assert.deepEqual([back.x, back.y, back.inside, back.front], [1050, 122, true, false]);
  near([back.distance], [1]);
  // 面板转过身(正面朝 -Z)：从 +Z 一侧打过去是背面，从 -Z 一侧是正面；页面的左右跟着面板转
  const flipped = pose(ry(180), [0, 1, -1]);
  const behind = hitOf(rayQuad([0.2002, 1.07, 0], [0, 0, -1], flipped, 0.8, 1400, 490));
  // 交点在面板自己的左边 0.2002 米：x = (0.5 − 0.2002 / 0.8) × 1400 = 349.65
  assert.deepEqual([behind.x, behind.y, behind.inside, behind.front], [349, 122, true, false]);
  const facing = hitOf(rayQuad([0.2002, 1.07, -2], [0, 0, 1], flipped, 0.8, 1400, 490));
  assert.deepEqual([facing.x, facing.y, facing.inside, facing.front], [349, 122, true, true]);
});

test('射线求交·平行：射线和面板平行时没有交点，起点在面板前面、后面、就在面板所在的平面上都一样', () => {
  for (const source of [[0, 1, 0], [0, 1, -2], [0, 1, -1]] as Vec3[]) {
    for (const dir of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0.6, -0.8, 0]] as Vec3[]) assert.equal(wide(source, dir), null);
  }
});

test('射线求交·边缘：落在边上算打在面板里，出了边不算；出了边的落点夹到边上，交点不夹', () => {
  const px = (hit: QuadHit | null): unknown[] => [hitOf(hit).x, hitOf(hit).y, hitOf(hit).inside];
  // 面板宽 0.8 米、高 0.28 米：右边在 x = 0.4，上边在 y = 1.14
  assert.deepEqual(px(wide([0.4, 1.07, 0], [0, 0, -1])), [1399, 122, true]);
  assert.deepEqual(px(wide([-0.4, 1.07, 0], [0, 0, -1])), [0, 122, true]);
  assert.deepEqual(px(wide([0.2002, 1.14, 0], [0, 0, -1])), [1050, 0, true]);
  assert.deepEqual(px(wide([0.2002, 0.86, 0], [0, 0, -1])), [1050, 489, true]);
  assert.deepEqual(px(wide([0.4004, 1.07, 0], [0, 0, -1])), [1399, 122, false]);
  assert.deepEqual(px(wide([-0.4004, 1.07, 0], [0, 0, -1])), [0, 122, false]);
  assert.deepEqual(px(wide([0.2002, 1.1404, 0], [0, 0, -1])), [1050, 0, false]);
  assert.deepEqual(px(wide([0.2002, 0.8596, 0], [0, 0, -1])), [1050, 489, false]);
  const far = hitOf(wide([3, 4, 0], [0, 0, -1]));
  assert.deepEqual([far.x, far.y, far.inside], [1399, 0, false]);
  near(far.point, [3, 4, -1]);
});

test('夹进面板：面板外的一点挪到最近的边或角上，面板里的不动；斜着的面板照它自己的左右上下夹', () => {
  // 面板宽 0.8 米、高 0.28 米，中心在 (0, 1, -1)：右边在 x = 0.4，上边在 y = 1.14
  near(clampToQuad([3, 4, -1], WIDE.at, 0.8, 0.35), [0.4, 1.14, -1]);
  near(clampToQuad([-0.5, 1.05, -1], WIDE.at, 0.8, 0.35), [-0.4, 1.05, -1]);
  near(clampToQuad([0.1, 0.5, -1], WIDE.at, 0.8, 0.35), [0.1, 0.86, -1]);
  near(clampToQuad([0.1, 1.05, -1], WIDE.at, 0.8, 0.35), [0.1, 1.05, -1]);
  // 绕 Y 转 90° 的面板：宽沿 -Z，正面朝 +X
  const side = pose(ry(90), [1, 1, -1]);
  near(clampToQuad([1, 2, -3], side, 0.8, 0.5), [1, 1.2, -1.4]);
  near(clampToQuad([1, 0.9, 0], side, 0.8, 0.5), [1, 0.9, -0.6]);
});

test('射线求交·斜着看：射线斜着打、面板转过或仰着时落点照面板自己的左右上下算', () => {
  // 从右上方斜着打向面板上 (-0.1002, 0.95, -1)：x = (0.5 − 0.1002 / 0.8) × 1400 = 524.65，y = (0.5 + 0.05 / 0.28) × 490 = 332.5
  const slant = hitOf(wide([0.5, 1.5, 0], [-0.6002, -0.55, -1]));
  assert.deepEqual([slant.x, slant.y, slant.inside, slant.front], [524, 332, true, true]);
  near(slant.point, [-0.1002, 0.95, -1]);
  near([slant.distance], [Math.sqrt(0.6002 * 0.6002 + 0.55 * 0.55 + 1)]);

  // 面板朝 +X(绕 Y 转 90°)，中心在 (0, 1, 0)：面板的右边是世界的 -Z
  const side = hitOf(rayQuad([1, 1.07, -0.2002], [-1, 0, 0], pose(ry(90), [0, 1, 0]), 0.8, 1400, 490));
  assert.deepEqual([side.x, side.y, side.inside, side.front], [1050, 122, true, true]);
  near(side.point, [0, 1.07, -0.2002]);
  near([side.distance], [1]);

  // 面板向后仰 30°，中心在 (0, 1, -1)：它的上方是 (0, cos30°, -sin30°)，法线是 (0, sin30°, cos30°)。
  // 沿法线从 0.7 米外打向面板上「右 0.1002 米、上 0.07 米」的点：x = (0.1002 / 0.8 + 0.5) × 1400 = 875.35，y = 122.5
  const up: Vec3 = [0, Math.cos(rad(30)), -Math.sin(rad(30))];
  const normal: Vec3 = [0, Math.sin(rad(30)), Math.cos(rad(30))];
  const target: Vec3 = [0.1002, 1 + 0.07 * up[1], -1 + 0.07 * up[2]];
  const source: Vec3 = [target[0], target[1] + 0.7 * normal[1], target[2] + 0.7 * normal[2]];
  const tilted = hitOf(rayQuad(source, [0, -normal[1], -normal[2]], pose(rx(-30), [0, 1, -1]), 0.8, 1400, 490));
  assert.deepEqual([tilted.x, tilted.y, tilted.inside, tilted.front], [875, 122, true, true]);
  near(tilted.point, target);
  near([tilted.distance], [0.7]);
});

test('射线求交：和面板平行、面板在射线后面、方向是零向量、尺寸不是正数时没有交点', () => {
  assert.equal(wide([0, 1, 0], [1, 0, 0]), null);
  assert.equal(wide([0, 1, 0], [0, 1, 0]), null);
  assert.equal(wide([0, 1, 0], [0, 0, 1]), null);
  assert.equal(wide([0, 1, -2], [0, 0, -1]), null);
  assert.equal(wide([0, 1, 0], [0, 0, 0]), null);
  for (const [meters, width, height] of [[0, 1400, 490], [-0.8, 1400, 490], [0.8, 0, 490], [0.8, 1400, 0], [NaN, 1400, 490]] as const) {
    assert.equal(rayQuad([0, 1, 0], [0, 0, -1], WIDE.at, meters, width, height), null, `${meters} ${width} ${height}`);
  }
});

test('选最近的正面命中：背面的、没打在面板里的、没有交点的不算；距离一样时取前面的', () => {
  const hit = (distance: number, front = true, inside = true): QuadHit => ({ x: 0, y: 0, inside, front, point: [0, 0, 0], distance });
  assert.equal(nearestHit([]), -1);
  assert.equal(nearestHit([null, null]), -1);
  assert.equal(nearestHit([hit(0.9), hit(0.5), hit(0.7)]), 1);
  assert.equal(nearestHit([null, hit(0.9), hit(0.3, false), hit(0.2, true, false), hit(0.5)]), 4);
  assert.equal(nearestHit([hit(0.3, false), hit(0.2, true, false), null]), -1);
  assert.equal(nearestHit([hit(0.5), hit(0.5), hit(0.5)]), 0);

  // 两块面板一前一后挡在同一条射线上：近的在 0.5 米，远的在 1 米
  const front = pose(NONE, [0, 1, -0.5]);
  const rear = pose(NONE, [0, 1, -1]);
  const cast = (panels: Mat34[], width: number): number => nearestHit(panels.map(p => rayQuad([0.05, 1.01, 0], [0, 0, -1], p, width, 400, 400)));
  assert.equal(cast([rear, front], 0.4), 1);
  assert.equal(cast([front, rear], 0.4), 0);
  // 近的那块转过身(背对着)：取远的
  assert.equal(cast([pose(ry(180), [0, 1, -0.5]), rear], 0.4), 1);
  // 近的那块小、射线从它旁边过：取远的
  assert.equal(nearestHit([rayQuad([0.05, 1.01, 0], [0, 0, -1], front, 0.05, 400, 400), rayQuad([0.05, 1.01, 0], [0, 0, -1], rear, 0.4, 400, 400)]), 1);
  // 两块都背对着
  assert.equal(cast([pose(ry(180), [0, 1, -0.5]), pose(ry(180), [0, 1, -1])], 0.4), -1);
});

test('松手吸正：侧倾 8° 以内归零，离竖直 6° 以内立正；位置和朝哪边不变，超过的不动', () => {
  // 侧倾归零，仰着的角度留着
  near(settlePose(turned(40, 20, 5)), turned(40, 20, 0));
  near(settlePose(turned(40, 20, -7.9)), turned(40, 20, 0));
  near(settlePose(turned(-120, -35, 7.9)), turned(-120, -35, 0));
  // 立正，侧倾超过的留着
  near(settlePose(turned(10, 4, 12)), turned(10, 0, 12));
  near(settlePose(turned(10, -5.9, -30)), turned(10, 0, -30));
  // 两样都在范围里：竖直、不侧倾
  near(settlePose(turned(-70, 4, 3)), turned(-70, 0, 0));
  near(settlePose(turned(-70, -5.9, -7.9)), turned(-70, 0, 0));
  near(settlePose(turned(180, 3, 2, [-1, 0.5, 2])), turned(180, 0, 0, [-1, 0.5, 2]));
  // 超过的给回同一份
  for (const [yaw, pitch, roll] of [[40, 20, 8.1], [40, 20, -12], [-70, 6.1, 9], [10, -30, 30], [10, 30, 175]] as const) {
    const leaning = turned(yaw, pitch, roll);
    assert.equal(settlePose(leaning), leaning, `${yaw} ${pitch} ${roll}`);
  }
  // 已经竖直、不侧倾的给回同一份
  const upright = turned(10, 0, 0);
  assert.equal(settlePose(upright), upright);
  assert.equal(settlePose(IDENTITY), IDENTITY);
  // 平躺着的(法线竖直)不动
  for (const pitch of [90, -90, 88, -88]) {
    const lying = turned(25, pitch, 3);
    assert.equal(settlePose(lying), lying, String(pitch));
  }
});

// 头在 (0, 1.6, 0)、朝 -Z、不低头
const HEAD: Mat34 = pose(NONE, [0, 1.6, 0]);
// 正前方的出现位置所在的圆弧(半径 0.65 米、比眼睛低 0.05 米)上，向右转 deg 度的那一点
const arc = (deg: number): Vec3 => [0.65 * Math.sin(rad(deg)), 1.55, -0.65 * Math.cos(rad(deg))];
const spot = (m: Mat34): Vec3 => [m[3], m[7], m[11]];

// 面板的姿态合不合「在 at、正面朝向 eye、不侧倾」
function faces(m: Mat34, at: Vec3, eye: Vec3): void {
  near(spot(m), at);
  const to: Vec3 = [eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]];
  const d = Math.hypot(to[0], to[1], to[2]);
  near([m[2], m[6], m[10]], [to[0] / d, to[1] / d, to[2] / d]);   // 法线指向眼睛
  near([m[4]], [0]);                                               // X 轴水平
  near([Math.hypot(m[0], m[4], m[8]), Math.hypot(m[1], m[5], m[9])], [1, 1]);
  near([m[0] * m[1] + m[4] * m[5] + m[8] * m[9], m[0] * m[2] + m[4] * m[6] + m[8] * m[10], m[1] * m[2] + m[5] * m[6] + m[9] * m[10]], [0, 0, 0]);
  assert.ok(m[5] > 0);                                             // 上边朝上
}

test('放到面前：三种 spawn 的位置以头的水平朝向为准，正面朝向眼睛', () => {
  // front：前方 0.65 米、比眼睛低 0.05 米。法线 = (0, 0.05, 0.65) / |…|，X 轴 = (1, 0, 0)，Y 轴 = (0, 法线.z, −法线.y)
  const h = Math.hypot(0.05, 0.65);
  near(arrange(HEAD, 'front', []), [1, 0, 0, 0, 0, 0.65 / h, 0.05 / h, 1.55, 0, -0.05 / h, 0.65 / h, -0.65]);
  // low：前方 0.55 米、比眼睛低 0.3 米
  const l = Math.hypot(0.3, 0.55);
  near(arrange(HEAD, 'low', []), [1, 0, 0, 0, 0, 0.55 / l, 0.3 / l, 1.3, 0, -0.3 / l, 0.55 / l, -0.55]);
  // side：右前 35° 方向 0.65 米
  faces(arrange(HEAD, 'side', []), arc(35), [0, 1.6, 0]);
  assert.ok(arc(35)[0] > 0);

  // 头在 (1, 1.6, 2)、朝 -X：前方是 -X，右边是 -Z
  const eye: Vec3 = [1, 1.6, 2];
  const west = pose(ry(90), eye);
  faces(arrange(west, 'front', []), [0.35, 1.55, 2], eye);
  faces(arrange(west, 'low', []), [0.45, 1.3, 2], eye);
  faces(arrange(west, 'side', []), [1 - 0.65 * Math.cos(rad(35)), 1.55, 2 - 0.65 * Math.sin(rad(35))], eye);
  // 低头 40°、歪头 20°：位置只看水平朝向
  const bowed = pose(times(times(ry(90), rx(-40)), rz(20)), eye);
  faces(arrange(bowed, 'front', []), [0.35, 1.55, 2], eye);
  faces(arrange(bowed, 'low', []), [0.45, 1.3, 2], eye);
});

test('放到面前：出现位置 0.2 米内已有别的面板时沿水平圆弧换位置，依次 0°、+35°、−35°、+70°、−70°；都占了就在 0° 处朝头每块错开 5 厘米', () => {
  const at = (others: Vec3[]): Vec3 => spot(arrange(HEAD, 'front', others));
  near(at([]), arc(0));
  near(at([arc(0)]), arc(35));
  near(at([arc(0), arc(35)]), arc(-35));
  near(at([arc(0), arc(35), arc(-35)]), arc(70));
  near(at([arc(0), arc(35), arc(-35), arc(70)]), arc(-70));
  // 换了位置也正面朝向眼睛
  faces(arrange(HEAD, 'front', [arc(0), arc(35)]), arc(-35), [0, 1.6, 0]);
  // 只占了后面几个方向：还是放在 0°
  near(at([arc(35), arc(-35), arc(70), arc(-70)]), arc(0));
  // 0.2 米以内才算占着
  near(at([[0.19, 1.55, -0.65]]), arc(35));
  near(at([[0.21, 1.55, -0.65]]), arc(0));
  near(at([[0, 1.55 - 0.19, -0.65]]), arc(35));
  // 键盘在它的出现位置(前方 0.55 米、低 0.3 米)：离正前方的位置 0.27 米，不挡
  near(at([[0, 1.3, -0.55]]), arc(0));

  // 五个方向都占了：0° 处朝头错开 5 厘米；那里也占了再错开 5 厘米
  const five = [arc(0), arc(35), arc(-35), arc(70), arc(-70)];
  near(at(five), [0, 1.55, -0.6]);
  near(at([...five, [0, 1.55, -0.6]]), [0, 1.55, -0.55]);
  near(at([...five, [0, 1.55, -0.6], [0, 1.55, -0.55]]), [0, 1.55, -0.5]);
  faces(arrange(HEAD, 'front', five), [0, 1.55, -0.6], [0, 1.6, 0]);
  // 一路错开到离眼睛 0.2 米(水平方向)为止，再多也放在那里
  const stack: Vec3[] = [1, 2, 3, 4, 5, 6, 7, 8].map((k): Vec3 => [0, 1.55, -0.65 + 0.05 * k]);
  near(at([...five, ...stack]), [0, 1.55, -0.2]);
  near(at([...five, ...stack, [0, 1.55, -0.2]]), [0, 1.55, -0.2]);

  // low 的圆弧半径 0.55 米、低 0.3 米
  const low = (deg: number): Vec3 => [0.55 * Math.sin(rad(deg)), 1.3, -0.55 * Math.cos(rad(deg))];
  near(spot(arrange(HEAD, 'low', [low(0)])), low(35));
  near(spot(arrange(HEAD, 'low', [low(0), low(35), low(-35), low(70), low(-70)])), [0, 1.3, -0.5]);
  // side 从右前 35° 起：依次 35°、70°、0°、105°、−35°
  near(spot(arrange(HEAD, 'side', [arc(35)])), arc(70));
  near(spot(arrange(HEAD, 'side', [arc(35), arc(70)])), arc(0));
  near(spot(arrange(HEAD, 'side', [arc(35), arc(70), arc(0)])), arc(105));
  near(spot(arrange(HEAD, 'side', [arc(35), arc(70), arc(0), arc(105)])), arc(-35));
});

test('恢复时的摆放：不动、只拉回不在面前的、每次重排；还没摆过的都要放', () => {
  const rules = (panel: Mat34 | null, head: Mat34 = HEAD): boolean[] => [needsArrange('never', panel, head), needsArrange('away', panel, head), needsArrange('always', panel, head)];
  assert.deepEqual(rules(null), [true, true, true]);
  // 面板在眼睛正前方 0.6 米、正面朝着人
  assert.deepEqual(rules(pose(NONE, [0, 1.6, -0.6])), [false, false, true]);
  // 离眼睛不到 0.2 米、超过 1.5 米
  assert.deepEqual(rules(pose(NONE, [0, 1.6, -0.19])), [false, true, true]);
  assert.deepEqual(rules(pose(NONE, [0, 1.6, -0.21])), [false, false, true]);
  assert.deepEqual(rules(pose(NONE, [0, 1.6, -1.51])), [false, true, true]);
  assert.deepEqual(rules(pose(NONE, [0, 1.6, -1.49])), [false, false, true]);
  // 偏离视线：在右前 deg 度方向 0.6 米处、正面朝着人(法线指回眼睛)
  const off = (deg: number): Mat34 => pose(ry(-deg), [0.6 * Math.sin(rad(deg)), 1.6, -0.6 * Math.cos(rad(deg))]);
  assert.deepEqual(rules(off(49)), [false, false, true]);
  assert.deepEqual(rules(off(51)), [false, true, true]);
  assert.deepEqual(rules(off(-49)), [false, false, true]);
  assert.deepEqual(rules(off(-51)), [false, true, true]);
  // 在身后
  assert.deepEqual(rules(pose(ry(180), [0, 1.6, 0.6])), [false, true, true]);
  // 在正前方但背对着人
  assert.deepEqual(rules(pose(ry(180), [0, 1.6, -0.6])), [false, true, true]);
  // 在正前方、侧过 80° 还算朝着人，侧过 100° 是背对
  assert.deepEqual(rules(pose(ry(80), [0, 1.6, -0.6])), [false, false, true]);
  assert.deepEqual(rules(pose(ry(100), [0, 1.6, -0.6])), [false, true, true]);
  // 在脚边(低 0.8 米、前 0.3 米)：视线抬着看不到(偏了 69°)
  const low = pose(rx(-60), [0, 0.8, -0.3]);
  assert.deepEqual(rules(low), [false, true, true]);
  // 头转向 +X：-Z 方向的面板在左边 90°，+X 方向的面板在面前
  const east = pose(ry(-90), [0, 1.6, 0]);
  assert.deepEqual(rules(pose(NONE, [0, 1.6, -0.6]), east), [false, true, true]);
  assert.deepEqual(rules(pose(ry(-90), [0.6, 1.6, 0]), east), [false, false, true]);
  // 低头 60° 看脚边的面板：在面前
  assert.deepEqual(rules(low, pose(rx(-60), [0, 1.6, 0])), [false, false, true]);
});

test('附着：相对附着对象的变换和面板空间里的姿态互相换算；留在空间里的面板附着对象是原点', () => {
  // 附着对象在 (1, 2, 3)、绕 Y 转了 90°；面板在它自己的右边 0.1 米、前方 0.2 米，不转
  const device = pose(ry(90), [1, 2, 3]);
  const offset = pose(NONE, [0.1, 0, -0.2]);
  // 绕 Y 转 90° 把 (0.1, 0, -0.2) 变成 (-0.2, 0, -0.1)
  const world = pose(ry(90), [0.8, 2, 2.9]);
  near(anchorPose(device, offset), world);
  near(relativeTo(world, device), offset);
  // 相对变换自己也带旋转(后仰 30°)：和附着对象的旋转叠在一起
  const leaning = pose(rx(-30), [0, 0.05, -0.1]);
  const placed = pose(times(ry(90), rx(-30)), [0.9, 2.05, 3]);
  near(anchorPose(device, leaning), placed);
  near(relativeTo(placed, device), leaning);
  // 留在空间里
  near(anchorPose(IDENTITY, world), world);
  near(relativeTo(world, IDENTITY), world);
});

test('附着的默认位置·头显：前方 0.45 米、下方 0.25 米，正面朝向眼睛；头转了、低了跟着走', () => {
  // 头显自己的坐标里：位置 (0, −0.25, −0.45)，法线 = (0, 0.25, 0.45) / |…|，X 轴 = (1, 0, 0)，Y 轴 = (0, 法线.z, −法线.y)
  const h = Math.hypot(0.25, 0.45);
  const local: Mat34 = [1, 0, 0, 0, 0, 0.45 / h, 0.25 / h, -0.25, 0, -0.25 / h, 0.45 / h, -0.45];
  near(anchorDefault('head'), local);
  // 头在 (0, 1.6, 0)、朝 −Z
  faces(anchorPose(HEAD, anchorDefault('head')), [0, 1.35, -0.45], [0, 1.6, 0]);
  // 头在 (1, 1.6, 2)、朝 −X：前方是 −X
  const eye: Vec3 = [1, 1.6, 2];
  faces(anchorPose(pose(ry(90), eye), anchorDefault('head')), [0.55, 1.35, 2], eye);
  // 低头 30°：面板跟着头往下、往近处转。绕 X 转 −30° 把 (0, −0.25, −0.45) 变成 (0, −0.25·cos30° − 0.45·sin30°, 0.25·sin30° − 0.45·cos30°)
  const c = Math.cos(rad(30));
  const bowed = anchorPose(pose(rx(-30), [0, 1.6, 0]), anchorDefault('head'));
  faces(bowed, [0, 1.6 - 0.25 * c - 0.45 * 0.5, 0.25 * 0.5 - 0.45 * c], [0, 1.6, 0]);
  // 歪头 20°：面板的左右跟着头歪，离眼睛的距离不变
  const tilted = anchorPose(pose(rz(20), [0, 1.6, 0]), anchorDefault('head'));
  near(spot(tilted), [0.25 * Math.sin(rad(20)), 1.6 - 0.25 * Math.cos(rad(20)), -0.45]);
  near([tilted[0], tilted[4], tilted[8]], [Math.cos(rad(20)), Math.sin(rad(20)), 0]);
  // 换算回去还是默认的相对变换
  near(relativeTo(bowed, pose(rx(-30), [0, 1.6, 0])), local);
});

test('附着的默认位置·手柄：朝手背一侧 0.05 米、朝手腕一侧 0.12 米，正面从朝手背转向手柄上方 40°；左右手互为镜像', () => {
  const c = Math.cos(rad(40));
  const s = Math.sin(rad(40));
  // 左手柄自己的坐标里：手背在 −X。位置 (−0.05, 0, 0.12)，法线 (−cos40°, sin40°, 0)，X 轴 (0, 0, −1)，Y 轴 = 法线 × X 轴 = (−sin40°, −cos40°, 0)
  const left = anchorDefault('left');
  near(left, [0, -s, -c, -0.05, 0, -c, s, 0, -1, 0, 0, 0.12]);
  // 右手柄：手背在 +X。位置 (0.05, 0, 0.12)，法线 (cos40°, sin40°, 0)，X 轴 (0, 0, 1)，Y 轴 (sin40°, −cos40°, 0)
  const right = anchorDefault('right');
  near(right, [0, s, c, 0.05, 0, -c, s, 0, 1, 0, 0, 0.12]);
  // 都是不带缩放的右手系：三根轴两两垂直、长度为 1，X 轴 × Y 轴 = 法线
  for (const m of [left, right, anchorDefault('head')]) {
    const [x, y, z]: [Vec3, Vec3, Vec3] = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]];
    near([Math.hypot(...x), Math.hypot(...y), Math.hypot(...z)], [1, 1, 1]);
    near([x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]], z);
  }

  // 抬左手看表(人朝 −Z 站着)：小臂横在胸前指向右边，手背朝上。手柄的 X 轴(掌心一侧)朝下、Y 轴(手柄上方)朝向人、Z 轴(手腕一侧)朝左
  const leftWatch = pose([0, 0, -1, -1, 0, 0, 0, 1, 0], [-0.1, 1.2, -0.3]);
  const onLeft = anchorPose(leftWatch, left);
  // 面板在手柄左边 0.12 米(手腕上)、上方 0.05 米；文字的右方是人的右方，法线朝上偏向人 40°，上边朝前上方
  near(onLeft, [1, 0, 0, -0.22, 0, s, c, 1.25, 0, -c, s, -0.3]);
  // 抬右手看表：小臂指向左边。手柄的 X 轴(手背一侧)朝上、Y 轴朝向人、Z 轴(手腕一侧)朝右
  const rightWatch = pose([0, 0, 1, 1, 0, 0, 0, 1, 0], [0.1, 1.2, -0.3]);
  const onRight = anchorPose(rightWatch, right);
  near(onRight, [1, 0, 0, 0.22, 0, s, c, 1.25, 0, -c, s, -0.3]);
  // 这两个姿态下正面朝着眼睛(头在 (0, 1.6, 0))：法线和面板到眼睛的方向夹角约 25.5°
  const toEye = Math.hypot(0.22, 0.35, 0.3);
  near([(0.35 * c + 0.3 * s) / toEye], [Math.cos(rad(25.52))], 1e-4);
  assert.deepEqual([glanceShown(HEAD, onLeft, false), glanceShown(HEAD, onRight, false)], [true, true]);
  // 手垂在身侧、手柄朝前：面板朝外侧上方，离眼睛的方向 70° 以上，不显示
  const leftDown = anchorPose(pose(NONE, [-0.3, 0.9, -0.1]), left);
  const rightDown = anchorPose(pose(NONE, [0.3, 0.9, -0.1]), right);
  near(spot(leftDown), [-0.35, 0.9, 0.02]);
  near([leftDown[2], leftDown[6], leftDown[10]], [-c, s, 0]);
  assert.deepEqual([glanceShown(HEAD, leftDown, true), glanceShown(HEAD, rightDown, true)], [false, false]);
  // 换算回去还是默认的相对变换
  near(relativeTo(onLeft, leftWatch), left);
  near(relativeTo(onRight, rightWatch), right);
});

test('抬手才显示：面板正面的法线和面板到眼睛的方向夹角小于 40° 显示出来，大于 50° 隐藏，两者之间照上一次的结果', () => {
  // 面板在 (0.2, 1.2, −0.4)、法线朝 +Z；眼睛在离它 d 米、偏离法线 deg 度的方向上(水平偏或竖直偏)
  const at: Vec3 = [0.2, 1.2, -0.4];
  const panel = pose(NONE, at);
  const beside = (deg: number, d = 0.5): Mat34 => pose(NONE, [at[0] + d * Math.sin(rad(deg)), at[1], at[2] + d * Math.cos(rad(deg))]);
  const above = (deg: number, d = 0.5): Mat34 => pose(NONE, [at[0], at[1] + d * Math.sin(rad(deg)), at[2] + d * Math.cos(rad(deg))]);
  const both = (head: Mat34): boolean[] => [glanceShown(head, panel, false), glanceShown(head, panel, true)];
  for (const eye of [beside, above]) {
    // 进入的角度两侧
    assert.deepEqual([both(eye(39.9)), both(eye(40.1))], [[true, true], [false, true]]);
    assert.deepEqual([both(eye(-39.9)), both(eye(-40.1))], [[true, true], [false, true]]);
    // 离开的角度两侧
    assert.deepEqual([both(eye(49.9)), both(eye(50.1))], [[false, true], [false, false]]);
    assert.deepEqual([both(eye(-49.9)), both(eye(-50.1))], [[false, true], [false, false]]);
    // 正对着、侧着、在背面
    assert.deepEqual([both(eye(0)), both(eye(90)), both(eye(180))], [[true, true], [false, false], [false, false]]);
    // 只看方向，不看远近
    assert.deepEqual([both(eye(39.9, 0.05)), both(eye(39.9, 3)), both(eye(50.1, 0.05)), both(eye(50.1, 3))], [[true, true], [true, true], [false, false], [false, false]]);
  }
  // 慢慢抬手再放下：45° 时没显示，过了 40° 显示，回到 45°、49° 还显示着，过了 50° 隐藏，再回到 45° 不显示
  const seen: boolean[] = [];
  for (const deg of [60, 45, 39, 45, 49, 51, 45]) seen.push(glanceShown(above(deg), panel, seen.at(-1) ?? false));
  assert.deepEqual(seen, [false, false, true, true, true, false, false]);
  // 只看头的位置，不看头朝哪
  const spun = pose(times(ry(140), rx(35)), [at[0] + 0.5 * Math.sin(rad(39.9)), at[1], at[2] + 0.5 * Math.cos(rad(39.9))]);
  assert.deepEqual(both(spun), [true, true]);
  // 面板转过去了：绕 Y 转 90° 后法线朝 +X，眼睛在它的 +X 一侧偏上 deg 度
  const side = pose(ry(90), at);
  const up = (deg: number): Mat34 => pose(NONE, [at[0] + 0.5 * Math.cos(rad(deg)), at[1] + 0.5 * Math.sin(rad(deg)), at[2]]);
  assert.deepEqual([glanceShown(up(39.9), side, false), glanceShown(up(40.1), side, false), glanceShown(up(49.9), side, true), glanceShown(up(50.1), side, true)], [true, false, true, false]);
  assert.deepEqual([glanceShown(beside(0), side, false), glanceShown(beside(0), side, true)], [false, false]);
  // 眼睛就在面板的原点上：照上一次的结果
  assert.deepEqual(both(pose(NONE, at)), [false, true]);
});

// ---------- 换坐标系 ----------

test('变换作用在点上带平移，作用在方向上只转不移', () => {
  const m: Mat34 = [0, 0, 1, 1, 0, 1, 0, 0.5, -1, 0, 0, -2];   // 绕 Y 轴转 90°，再平移 (1, 0.5, -2)
  assert.deepEqual(applyPoint(m, [1, 2, 3]), [4, 2.5, -3]);
  assert.deepEqual(applyDir(m, [1, 2, 3]), [3, 2, -1]);
  assert.deepEqual(applyPoint(IDENTITY, [1, 2, 3]), [1, 2, 3]);
});

test('刚体变换的判断：单位阵、任意转动加平移是；项数不对、有非有限的数、全零、带缩放、歪斜、镜像都不是', () => {
  const turned: Mat34 = [...times(ry(30), rx(20)).flatMap((v, i) => (i % 3 === 2 ? [v, [0.5, -1, 2][(i - 2) / 3] ?? 0] : [v]))] as Mat34;
  assert.deepEqual([isRigid(IDENTITY), isRigid(turned), isRigid(Array.from(new Float32Array(turned)))], [true, true, true]);
  assert.equal(isRigid([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), false);
  assert.equal(isRigid([...IDENTITY, 0]), false);
  assert.equal(isRigid(IDENTITY.map((v, i) => (i === 7 ? NaN : v))), false);
  assert.equal(isRigid(IDENTITY.map((v, i) => (i === 3 ? Infinity : v))), false);
  assert.equal(isRigid(new Array<number>(12).fill(0)), false);
  assert.equal(isRigid([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0]), false);
  assert.equal(isRigid([1.01, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]), false);
  assert.equal(isRigid([1, 0.01, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]), false);
  assert.equal(isRigid([1, 0, 0, 0, 0, 1, 0.01, 0, 0, 0, 1, 0]), false);
  assert.equal(isRigid([1, 0, 0, 0, 0, 1, 0, 0, 0.01, 0, 1, 0]), false);
  // 容差：行的长度差 0.0005 算是，差 0.002 不算
  assert.equal(isRigid([1.0005, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]), true);
  assert.equal(isRigid([1.002, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]), false);
  assert.equal(isRigid([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0]), false);
});

test('两个 Y 朝上的坐标系之间的变换：只有绕 Y 轴的转动和平移，把一个姿态在前一个坐标系里的位置正好送到后一个里的位置', () => {
  const shift: Mat34 = [0, 0, 1, 1, 0, 1, 0, 0.5, -1, 0, 0, -2];
  // 头在前一个坐标系里：抬头 20°、歪头 10°，在 (0.2, 1.6, 0.3)
  const tilt = times(rx(20), rz(10));
  const from: Mat34 = [tilt[0], tilt[1], tilt[2], 0.2, tilt[3], tilt[4], tilt[5], 1.6, tilt[6], tilt[7], tilt[8], 0.3];
  // 同一个头在后一个坐标系里：shift 作用在它上面
  const turn = times(ry(90), tilt);
  const to: Mat34 = [turn[0], turn[1], turn[2], 1.3, turn[3], turn[4], turn[5], 2.1, turn[6], turn[7], turn[8], -2.2];
  near(levelBetween(to, from), shift);
  near(levelBetween(from, from), IDENTITY);
  // 两个姿态的俯仰和侧倾不一样(读数有误差)：结果还是只绕 Y 轴转，位置照样对上
  const nod = times(ry(90), times(rx(23), rz(14)));
  const off: Mat34 = [nod[0], nod[1], nod[2], 1.3, nod[3], nod[4], nod[5], 2.1, nod[6], nod[7], nod[8], -2.2];
  const level = levelBetween(off, from);
  assert.deepEqual([level[1], level[4], level[5], level[6], level[9]], [0, 0, 1, 0, 0]);
  assert.ok(isRigid(level));
  near(applyPoint(level, [0.2, 1.6, 0.3]), [1.3, 2.1, -2.2]);
  // 转角：两个姿态之间的转动 Ry(90°)·Rx(23°)·Rz(14°)·(Rx(20°)·Rz(10°))ᵀ 里绕 Y 轴的那一份，离 90° 不到 3°，又不正好是 90°
  const yaw = Math.atan2(level[2], level[0]) * 180 / Math.PI;
  const between = times(nod, [tilt[0], tilt[3], tilt[6], tilt[1], tilt[4], tilt[7], tilt[2], tilt[5], tilt[8]]);
  near([yaw], [Math.atan2(between[2] - between[6], between[0] + between[8]) * 180 / Math.PI]);
  assert.ok(Math.abs(yaw - 90) < 3 && Math.abs(yaw - 90) > 1e-3, String(yaw));
});
