import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { approach, arrange, axis, dotPose, facing, IDENTITY, invert, mul, position, uvToPixel, withinReach, type Mat34 } from '../components/steamvr/src/geometry.ts';
import { needTip, nextDotShown } from '../components/steamvr/src/pointer.ts';

const near = (a: readonly number[], b: readonly number[], eps = 1e-6): void =>
  a.forEach((v, i) => assert.ok(Math.abs(v - (b[i] ?? NaN)) < eps, `${a.map(x => x.toFixed(4)).join(',')} ≠ ${b.join(',')}`));

// 绕 Y 转 90°(看向 -X)，平移 (1, 2, 3)
const M: Mat34 = [0, 0, 1, 1, 0, 1, 0, 2, -1, 0, 0, 3];
const HEAD: Mat34 = [1, 0, 0, 0, 0, 1, 0, 1.6, 0, 0, 1, 0];   // 原点，眼高 1.6，看向 -Z
// 键盘的出现位置(清单的 spawn 是 low)，周围没有别的面板
const spawnPose = (head: Mat34): Mat34 => arrange(head, 'low', []);

test('矩阵：乘自己的逆得单位阵', () => {
  near(mul(M, invert(M)), IDENTITY);
  near(mul(invert(M), M), IDENTITY);
});

test('出现位置：头前方 0.55 米、眼睛下方 0.3 米，正面朝向眼睛', () => {
  const k = spawnPose(HEAD);
  near(position(k), [0, 1.3, -0.55]);
  const toEye: [number, number, number] = [0, 0.3, 0.55];
  const n = Math.hypot(...toEye);
  near(axis(k, 2), toEye.map(v => v / n));
  near([axis(k, 0)[1]], [0]);   // 不侧倾
  assert.ok(withinReach(k, HEAD));
});

test('出现位置只看水平朝向：低头、侧倾都一样', () => {
  const c = Math.cos(0.6), s = Math.sin(0.6);
  const down: Mat34 = [1, 0, 0, 0, 0, c, -s, 1.6, 0, s, c, 0];     // 低头
  const roll: Mat34 = [c, -s, 0, 0, s, c, 0, 1.6, 0, 0, 1, 0];     // 侧倾
  near(spawnPose(down), spawnPose(HEAD), 1e-9);
  near(spawnPose(roll), spawnPose(HEAD), 1e-9);
});

test('还在面前：身后、太远、背对着都不算', () => {
  const eye: [number, number, number] = [0, 1.6, 0];
  assert.equal(withinReach(facing([0, 1.6, 1], eye), HEAD), false);        // 身后
  assert.equal(withinReach(facing([0, 1.6, -3], eye), HEAD), false);       // 太远
  assert.equal(withinReach(facing([0, 1.6, -0.6], [0, 1.6, -2]), HEAD), false);   // 背对
  assert.equal(withinReach(facing([0.3, 1.3, -0.6], eye), HEAD), true);
});

test('平滑：dt=0 不动，dt 很大到达目标，中间仍是纯旋转', () => {
  const a = spawnPose(HEAD);
  const b = facing([1, 1, -1], [0, 1.6, 0]);
  near(approach(a, b, 0, 0.04), a, 1e-9);
  near(approach(a, b, 10, 0.04), b, 1e-6);
  const m = approach(a, b, 0.02, 0.04);
  for (const c of [0, 1, 2] as const) near([Math.hypot(...axis(m, c))], [1], 1e-9);
});

test('指针圆点：沿面板正面抬起 2 毫米，朝向和面板相同', () => {
  const k = spawnPose(HEAD);
  const d = dotPose(k, position(k));
  const n = axis(k, 2);
  near(position(d), position(k).map((v, i) => v + (n[i] ?? 0) * 0.002));
  near(axis(d, 2), n);
});

test('射线落点：v 按正方形算，2:1 的面板只占中间一半', () => {
  assert.deepEqual(uvToPixel(0.5, 0.5, 1400, 700), { x: 700, y: 350 });   // 正中
  assert.deepEqual(uvToPixel(0, 0.75, 1400, 700), { x: 0, y: 0 });        // 左上角
  assert.deepEqual(uvToPixel(1, 0.25, 1400, 700), { x: 1399, y: 699 });   // 右下角：最后一列、最后一行，不超出页面
  assert.deepEqual(uvToPixel(1, 0.75, 1400, 700), { x: 1399, y: 0 });     // 右上角
  assert.deepEqual(uvToPixel(0, 0.25, 1400, 700), { x: 0, y: 699 });      // 左下角
  assert.deepEqual(uvToPixel(0.9995, 0.251, 1400, 700), { x: 1399, y: 698 });   // 紧挨着右边、下边
  assert.deepEqual(uvToPixel(0.25, 0.6, 1400, 700), { x: 350, y: 210 });
  assert.equal(uvToPixel(0.5, 0.8, 1400, 700), null);    // 面板上方
  assert.equal(uvToPixel(0.5, 0.2, 1400, 700), null);    // 面板下方
  assert.equal(uvToPixel(-0.01, 0.5, 1400, 700), null);
  assert.equal(uvToPixel(1.01, 0.5, 1400, 700), null);
});

test('射线落点：正方形面板 v 占满，尺寸为 0 时没有落点', () => {
  assert.deepEqual(uvToPixel(0.5, 1, 512, 512), { x: 256, y: 0 });
  assert.deepEqual(uvToPixel(0.5, 0, 512, 512), { x: 256, y: 511 });
  assert.deepEqual(uvToPixel(1, 0, 512, 512), { x: 511, y: 511 });
  assert.equal(uvToPixel(0.5, 0.5, 0, 0), null);
  assert.equal(uvToPixel(0.5, 0.5, 1400, 0), null);
});

// 逐帧喂「这一帧指没指着键盘」，记下对 SteamVR 的显示 / 隐藏调用；ok(第几次调用) 决定那次调用成不成功
function dotFrames(frames: readonly boolean[], ok: (call: number) => boolean = () => true): { calls: string[]; shown: boolean } {
  const calls: string[] = [];
  let shown = false;
  for (const on of frames) {
    shown = nextDotShown(shown, on, want => {
      calls.push(want ? 'show' : 'hide');
      return ok(calls.length);
    });
  }
  return { calls, shown };
}

test('圆点：连续指着只显示一次，移开只隐藏一次', () => {
  assert.deepEqual(dotFrames([false, false]), { calls: [], shown: false });   // 没指着过：不调用
  assert.deepEqual(dotFrames([true, true, true]), { calls: ['show'], shown: true });
  assert.deepEqual(dotFrames([true, true, false, false, false]), { calls: ['show', 'hide'], shown: false });
  assert.deepEqual(dotFrames([true, false, true, true, false]), { calls: ['show', 'hide', 'show', 'hide'], shown: false });
});

test('圆点：显示或隐藏没成功时下一帧重试，成功后停下', () => {
  // 第 1、2 次调用失败
  assert.deepEqual(dotFrames([true, true, true, true], n => n > 2), { calls: ['show', 'show', 'show'], shown: true });
  // 显示成功，随后隐藏的第 1 次(总第 2 次)失败
  assert.deepEqual(dotFrames([true, false, false, false], n => n !== 2), { calls: ['show', 'hide', 'hide'], shown: false });
  // 显示一直失败时记着的状态保持「没显示」，移开时不调隐藏
  assert.deepEqual(dotFrames([true, true, false], () => false), { calls: ['show', 'show'], shown: false });
});

// 一只手逐帧取指尖：frame(设备序号, 时间 ms, 手柄模型里有没有指尖) 照 needTip 的结论取，fetched 记下每次取的时间
function tipFrames(): { frame(device: number, now: number, available: boolean): void; fetched: number[]; hasTip(): boolean } {
  const fetched: number[] = [];
  let prev = -1, tip = false, tipAt = 0;
  return {
    fetched,
    hasTip: () => tip,
    frame(device, now, available) {
      const valid = device >= 1;
      if (!needTip(prev, device, valid, tip, now, tipAt)) return;
      prev = device;
      tip = valid && available;
      tipAt = now;
      fetched.push(now);
    },
  };
}

test('指尖：取不到时满 1 秒才重取，取到后停下', () => {
  const hand = tipFrames();
  for (const now of [5000, 5011, 5500, 5999]) hand.frame(3, now, false);
  assert.deepEqual(hand.fetched, [5000]);          // 序号变了取一次，之后 1 秒内不取
  hand.frame(3, 6000, false);
  hand.frame(3, 6999, false);
  assert.deepEqual(hand.fetched, [5000, 6000]);    // 间隔从最近一次取算起
  hand.frame(3, 7000, true);
  assert.equal(hand.hasTip(), true);
  for (const now of [7011, 8000, 20000]) hand.frame(3, now, false);
  assert.deepEqual(hand.fetched, [5000, 6000, 7000]);
});

test('指尖：设备序号变了立即取，序号无效时不重取', () => {
  const hand = tipFrames();
  hand.frame(-1, 100, false);
  hand.frame(-1, 5000, false);
  assert.deepEqual(hand.fetched, []);              // 手柄没开：序号没变、也无效
  hand.frame(3, 5011, false);
  hand.frame(4, 5022, true);                       // 刚取过也立即取
  assert.deepEqual(hand.fetched, [5011, 5022]);
  hand.frame(4, 9000, true);
  hand.frame(5, 9011, true);                       // 已经有指尖，换了设备照样取
  hand.frame(-1, 9022, true);                      // 手柄关了：序号变了，清掉指尖
  assert.deepEqual(hand.fetched, [5011, 5022, 9011, 9022]);
  assert.equal(hand.hasTip(), false);
  hand.frame(-1, 60000, true);
  assert.deepEqual(hand.fetched, [5011, 5022, 9011, 9022]);
});

test('指尖：needTip 的各个分支', () => {
  assert.equal(needTip(-1, 3, true, false, 0, 0), true);         // 序号变了
  assert.equal(needTip(3, 3, true, true, 99999, 0), false);      // 有指尖
  assert.equal(needTip(3, 3, true, false, 1999, 1000), false);   // 差 1ms 不到 1 秒
  assert.equal(needTip(3, 3, true, false, 2000, 1000), true);    // 正好 1 秒
  assert.equal(needTip(0, 0, false, false, 99999, 0), false);    // 序号无效
});

test('指针贴图：生成好的 128×128 RGBA PNG', () => {
  const png = fs.readFileSync(new URL('../resources/vr/pointer.png', import.meta.url));
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]], [128, 128, 8, 6]);
});

test('程序的描述：package.json 说的是组件平台，给 SteamVR 看的应用清单说的是面板平台；应用键、启动方式、动作清单不变', () => {
  const read = (file: string): unknown => JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  const pkg = read('package.json') as { description: string };
  assert.match(pkg.description, /组件平台/);
  assert.match(pkg.description, /VRChat/);
  const manifest = read('resources/vr/manifest.vrmanifest') as { applications: { app_key: string; launch_type: string; is_dashboard_overlay: boolean; action_manifest_path: string; strings: Record<string, { name: string; description: string }> }[] };
  assert.equal(manifest.applications.length, 1);
  const app = manifest.applications[0];
  assert.deepEqual([app?.app_key, app?.launch_type, app?.is_dashboard_overlay, app?.action_manifest_path], ['yanuo.foxpanel', 'binary', true, 'actions.json']);
  assert.deepEqual(Object.keys(app?.strings ?? {}), ['en_us', 'zh_cn']);
  assert.deepEqual([app?.strings['en_us']?.name, app?.strings['zh_cn']?.name], ['FoxPanel', 'FoxPanel']);
  assert.match(app?.strings['zh_cn']?.description ?? '', /面板平台/);
  assert.match(app?.strings['en_us']?.description ?? '', /panel platform/);
});

interface ActionManifest {
  actions: { name: string; requirement: string; type: string }[];
  action_sets: { name: string; usage: string }[];
  default_bindings: { controller_type: string; binding_url: string }[];
  localization: Record<string, string>[];
}
interface BindingFile {
  controller_type: string;
  app_key: string;
  description: string;
  bindings: Record<string, {
    sources: { path: string; mode: string; parameters?: Record<string, string>; inputs: Record<string, { output: string }> }[];
    poses: { output: string; path: string }[];
  }>;
}
const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(new URL(`../resources/vr/${file}`, import.meta.url), 'utf8'));

test('动作清单：原有四个动作的路径不变，加两个快捷位键(1 号建议绑、2 号可选)；两种语言的文案说的是面板', () => {
  const actions = readJson('actions.json') as ActionManifest;
  assert.deepEqual(actions.actions.map(a => `${a.name} ${a.requirement} ${a.type}`), [
    '/actions/main/in/OverlayToggle mandatory boolean', '/actions/main/in/OverlayInteract mandatory boolean', '/actions/main/in/OverlayGrab mandatory boolean',
    '/actions/main/in/PanelQuick1 suggested boolean', '/actions/main/in/PanelQuick2 optional boolean',
    '/actions/main/in/Pointer mandatory pose',
  ]);
  assert.deepEqual(actions.action_sets, [{ name: '/actions/main', usage: 'leftright' }]);
  assert.deepEqual(actions.default_bindings, [
    { controller_type: 'knuckles', binding_url: 'bindings_knuckles.json' },
    { controller_type: 'oculus_touch', binding_url: 'bindings_oculus_touch.json' },
    { controller_type: 'vive_controller', binding_url: 'bindings_vive_controller.json' },
  ]);
  // 每个动作在两种语言里都有文案
  for (const text of actions.localization) for (const a of actions.actions) assert.ok(text[a.name], `${text['language_tag'] ?? ''} ${a.name}`);
  assert.deepEqual(actions.localization, [
    {
      language_tag: 'zh_cn', '/actions/main': 'FoxPanel',
      '/actions/main/in/OverlayToggle': '收起 / 恢复面板', '/actions/main/in/OverlayInteract': '点击', '/actions/main/in/OverlayGrab': '抓住面板',
      '/actions/main/in/PanelQuick1': '快捷面板 1', '/actions/main/in/PanelQuick2': '快捷面板 2', '/actions/main/in/Pointer': '指针',
    },
    {
      language_tag: 'en_us', '/actions/main': 'FoxPanel',
      '/actions/main/in/OverlayToggle': 'Stow / Restore Panels', '/actions/main/in/OverlayInteract': 'Click', '/actions/main/in/OverlayGrab': 'Grab Panel',
      '/actions/main/in/PanelQuick1': 'Quick Panel 1', '/actions/main/in/PanelQuick2': 'Quick Panel 2', '/actions/main/in/Pointer': 'Pointer',
    },
  ]);
});

// 三种手柄的默认绑定：总开关和 1 号快捷位各用哪个键
const BOUND = [
  { file: 'bindings_knuckles.json', type: 'knuckles', toggle: 'b', quick: 'b' },
  { file: 'bindings_oculus_touch.json', type: 'oculus_touch', toggle: 'b', quick: 'y' },
  { file: 'bindings_vive_controller.json', type: 'vive_controller', toggle: 'application_menu', quick: 'application_menu' },
] as const;

for (const want of BOUND) {
  test(`默认绑定 ${want.type}：两手扳机点击、两手握把抓住；右手双击收起和恢复，左手双击开关 1 号快捷位，2 号不绑；指针用两手的指尖`, () => {
    const file = readJson(want.file) as BindingFile;
    assert.deepEqual([file.controller_type, file.app_key], [want.type, 'yanuo.foxpanel']);
    assert.match(file.description, /收起或恢复面板/);
    assert.match(file.description, /快捷面板 1/);
    assert.deepEqual(Object.keys(file.bindings), ['/actions/main']);
    const { sources, poses } = file.bindings['/actions/main'] ?? { sources: [], poses: [] };
    // 每个键绑到哪个动作：「手 键 输入方式 → 动作」
    const bound = sources.flatMap(s => Object.entries(s.inputs).map(([input, to]) => `${s.path.replace('/user/hand/', '').replace('/input/', ' ')} ${input} → ${to.output}`));
    assert.deepEqual(bound.sort(), [
      'left grip click → /actions/main/in/overlaygrab',
      `left ${want.quick} double → /actions/main/in/panelquick1`,
      'left trigger click → /actions/main/in/overlayinteract',
      'right grip click → /actions/main/in/overlaygrab',
      `right ${want.toggle} double → /actions/main/in/overlaytoggle`,
      'right trigger click → /actions/main/in/overlayinteract',
    ].sort());
    assert.ok(sources.every(s => s.mode === 'button'));
    // 扳机：按下 0.7、松开 0.55
    for (const s of sources.filter(x => x.path.endsWith('/trigger'))) {
      assert.deepEqual(s.parameters, { click_activate_threshold: '0.7', click_deactivate_threshold: '0.55' });
    }
    assert.deepEqual(poses, [
      { output: '/actions/main/in/pointer', path: '/user/hand/left/pose/tip' },
      { output: '/actions/main/in/pointer', path: '/user/hand/right/pose/tip' },
    ]);
    // 绑定里写的动作都是动作清单里有的(绑定文件里是小写)
    const known = (readJson('actions.json') as ActionManifest).actions.map(a => a.name.toLowerCase());
    for (const to of [...sources.flatMap(s => Object.values(s.inputs).map(i => i.output)), ...poses.map(p => p.output)]) assert.ok(known.includes(to), to);
  });
}
