import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { GpuLost } from '../components/steamvr/src/api.ts';
import { check, deviceLost } from '../components/steamvr/src/d3d.ts';
import { FakeGpu, FakeVr, type Call } from '../components/steamvr/src/fake.ts';
import { IDENTITY } from '../components/steamvr/src/geometry.ts';
import { ROLE_LEFT } from '../components/steamvr/src/openvr.ts';
import { APP_KEY, overlayKey, Surface } from '../components/steamvr/src/surface.ts';
import { at, fakeClock, Page, textures } from './vr-helpers.ts';

// ---------- 假的 Vr 和 Gpu ----------

test('假 Vr：按键在更新动作集时生效，changed 只在变了的那一次为真', () => {
  const vr = new FakeVr();
  const set = vr.handle('set', '/actions/main');
  const grab = vr.handle('action', '/actions/main/in/OverlayGrab');
  const left = vr.handle('source', '/user/hand/left');
  const right = vr.handle('source', '/user/hand/right');
  assert.equal(vr.handle('action', '/actions/main/in/OverlayGrab'), grab);   // 同一个名字是同一个句柄
  assert.equal(vr.id('source', '/user/hand/right'), right);
  assert.equal(vr.id('action', '/没取过'), undefined);

  vr.press('/actions/main/in/OverlayGrab', '/user/hand/left', true);
  assert.deepEqual(vr.button(grab, left), { down: false, changed: false });  // 还没更新动作集
  vr.activate(set, 5);
  assert.deepEqual(vr.button(grab, left), { down: true, changed: true });
  assert.deepEqual(vr.button(grab, right), { down: false, changed: false });
  assert.equal(vr.priority, 5);
  vr.activate(set, 0);
  assert.deepEqual(vr.button(grab, left), { down: true, changed: false });
  vr.press('/actions/main/in/OverlayGrab', '/user/hand/left', false);
  vr.activate(set, 0);
  assert.deepEqual(vr.button(grab, left), { down: false, changed: true });
});

test('假 Vr：悬浮窗口的状态、姿态、事件；每次调用都记下来，设了出错的方法抛出', () => {
  const vr = new FakeVr();
  const h = vr.overlay('a:b', 'Name');
  const o = vr.find('a:b');
  assert.ok(o);
  assert.equal(o.visible, false);
  assert.equal(vr.show(h), true);
  assert.equal(o.visible, true);
  vr.stuck.add('a:b');
  assert.equal(vr.hide(h), false);
  assert.equal(o.visible, true);
  vr.setWidth(h, 0.5);
  vr.place(h, at(1, 2, 3));
  assert.deepEqual([o.pose, o.meters, o.name], [at(1, 2, 3), 0.5, 'Name']);
  // 键已经有了：接管那一个(先隐藏)，不另建
  assert.equal(vr.overlay('a:b', 'Again'), h);
  assert.deepEqual([vr.adopted, vr.overlays.length, o.visible, o.name], [['a:b'], 1, false, 'Name']);

  assert.equal(vr.roleIndex(ROLE_LEFT), 0xffffffff);                         // 没有设备
  vr.setRole(ROLE_LEFT, 3);
  assert.equal(vr.roleIndex(ROLE_LEFT), 3);
  vr.setPose(3, at(0, 1, 0));
  const pose = vr.poses();
  vr.setPose(3, null);                                                       // 取过的姿态不跟着变
  assert.deepEqual(pose(3), { valid: true, mat: at(0, 1, 0) });
  assert.deepEqual(pose(4), { valid: false, mat: IDENTITY });
  assert.equal(vr.poses()(3).valid, false);
  assert.equal(vr.tip(3, 0), null);
  vr.emit(700);
  assert.deepEqual(vr.events(), [700]);
  assert.deepEqual(vr.events(), []);
  assert.equal(vr.intersect(h, [0, 0, 0], [0, 0, -1]), null);

  vr.fail('refreshRate', '读不到');
  assert.throws(() => vr.refreshRate(), /读不到/);
  vr.fail('refreshRate', null);
  assert.equal(vr.refreshRate(), 90);
  assert.deepEqual(vr.args('setWidth'), [[h, 0.5]]);
  assert.deepEqual(vr.calls.slice(0, 3).map(c => `${c.on} ${c.name}`), ['vr overlay', 'vr show', 'vr hide']);

  vr.shutdown();                                                             // 结束会话时悬浮窗口都销毁
  assert.deepEqual([vr.closed, o.destroyed, o.visible], [true, true, false]);
  assert.notEqual(vr.overlay('a:b', 'Name'), h);                             // 销毁以后同一个键建出新的
  assert.deepEqual([vr.adopted.length, vr.overlays.length], [1, 2]);
});

test('假 Gpu：记下打开、复制、释放；重复释放、放掉以后再用都抛出', () => {
  const gpu = new FakeGpu(7n);
  const query = gpu.createQuery();
  const texture = gpu.createTexture(4, 2);
  assert.equal(gpu.luid, 7n);
  const source = gpu.beginCopy(11n, texture, query);
  assert.deepEqual(textures(gpu)[0]?.frames, [11n]);
  assert.equal(gpu.done(query), true);
  gpu.busy = true;
  assert.equal(gpu.done(query), false);
  gpu.busy = false;

  gpu.release(null);                                                         // 空值不管
  gpu.release(source);
  assert.throws(() => gpu.release(source), /放掉了两次/);
  assert.throws(() => gpu.release({}), /不是这里建的对象/);
  assert.throws(() => gpu.beginCopy(12n, source, query), /不是可用的纹理/);
  assert.throws(() => gpu.beginCopy(12n, texture, texture), /不是可用的查询/);
  gpu.closeHandle(11n);
  assert.throws(() => gpu.beginCopy(11n, texture, query), /已经关掉/);
  assert.deepEqual(gpu.closed, [11n]);
  assert.deepEqual(gpu.live().map(o => o.kind), ['query', 'texture']);

  gpu.release(texture);
  assert.throws(() => gpu.beginCopy(12n, texture, query), /不是可用的纹理/);
  gpu.dispose();
  assert.equal(gpu.disposed, true);
  assert.throws(() => gpu.createTexture(1, 1), /设备已经放掉/);
  assert.throws(() => gpu.dispose(), /设备已经放掉/);
  gpu.release(query);                                                        // 设备放掉以后还能放对象
  assert.deepEqual(gpu.live(), []);
  assert.deepEqual(gpu.args('closeHandle'), [[11n]]);
});

// ---------- 一块面板的悬浮窗口(Surface) ----------

test('悬浮窗口的键：应用键加面板 id；超过 100 个字符时截断，末尾是面板 id 的哈希，不同的面板不会撞', () => {
  assert.equal(APP_KEY, 'yanuo.foxpanel');
  assert.equal(overlayKey('yanuo.shell-classic'), 'yanuo.foxpanel:panel.yanuo.shell-classic');
  const long = (tail: string): string => `author.${'x'.repeat(120)}${tail}`;
  const a = overlayKey(long('a'));
  const b = overlayKey(long('b'));
  assert.deepEqual([a.length, b.length], [100, 100]);
  assert.match(a, /^yanuo\.foxpanel:panel\.author\.x+[0-9a-f]{8}$/);
  assert.notEqual(a, b);
  assert.equal(overlayKey(long('a')), a);
  // 正好 100 个字符的不截
  const edge = `a.${'y'.repeat(100 - 'yanuo.foxpanel:panel.a.'.length)}`;
  assert.equal(overlayKey(edge), `yanuo.foxpanel:panel.${edge}`);
});

// 一个悬浮窗口，接着一个假页面；shown 为真时先显示出来
function surfaceRig(t: TestContext, shown = true, everyFrame = true) {
  const clock = fakeClock(t);
  const calls: Call[] = [];
  const vr = new FakeVr(calls);
  const gpu = new FakeGpu(0n, calls);
  const page = new Page(gpu);
  const logs: string[] = [];
  const surface = new Surface(vr, gpu, { key: 'test:panel', name: 'Test', meters: 0.8, everyFrame }, page, text => { logs.push(text); });
  const overlay = vr.find('test:panel');
  assert.ok(overlay);
  if (shown) surface.setShown(true);
  // 过 ms 毫秒后提交一次；返回这次提交里对 Vr 和 Gpu 的调用(方法名)
  const submit = (ms = 10): string[] => {
    clock.now += ms;
    const from = calls.length;
    surface.submit();
    return calls.slice(from).map(c => c.name);
  };
  return { calls, vr, gpu, page, surface, logs, overlay, submit };
}

test('悬浮窗口：建的时候建悬浮窗口、进度查询，设好宽度，是隐藏的、还没放过位置', t => {
  const { calls, overlay, surface, gpu } = surfaceRig(t, false);
  assert.deepEqual(calls.map(c => `${c.name} ${c.args.join(' ')}`), ['overlay test:panel Test', 'createQuery ', `setWidth ${overlay.handle} 0.8`]);
  assert.equal(surface.handle, overlay.handle);
  assert.deepEqual([surface.visible, overlay.visible, surface.pose, surface.meters], [false, false, null, 0.8]);
  assert.deepEqual(gpu.live().map(o => o.kind), ['query']);
});

test('悬浮窗口：进度查询建不出来时销毁刚建的悬浮窗口，错误抛给调用方', () => {
  const vr = new FakeVr();
  const gpu = new FakeGpu();
  gpu.fail('createQuery', '设备没了');
  assert.throws(() => new Surface(vr, gpu, { key: 'test:panel', name: 'Test', meters: 0.8, everyFrame: true }, null, () => undefined), /设备没了/);
  assert.equal(vr.find('test:panel')?.destroyed, true);
  vr.fail('overlay', '建不出来');
  assert.throws(() => new Surface(vr, gpu, { key: 'test:panel', name: 'Test', meters: 0.8, everyFrame: true }, null, () => undefined), /建不出来/);
});

test('帧：复制到常驻纹理，完成后每个显示帧交给 SteamVR；隔 30 毫秒同一帧再复制一次，然后还给宿主', t => {
  const { vr, gpu, page, logs, overlay, submit } = surfaceRig(t);
  assert.deepEqual(submit(), []);                                           // 还没有帧
  page.send(1);
  assert.deepEqual(submit(), ['release', 'createTexture', 'beginCopy']);    // 复制中，不交
  const [texture] = textures(gpu);
  assert.ok(texture);
  assert.deepEqual([texture.width, texture.height, texture.frames], [1400, 700, [1001n]]);
  assert.deepEqual(logs, ['纹理 1400×700']);
  assert.equal(overlay.texture, null);

  assert.deepEqual(submit(), ['done', 'release', 'setTexture']);            // 复制完成：放掉源纹理，交纹理
  assert.equal(overlay.texture, texture);
  assert.deepEqual(vr.args('setTexture'), [[overlay.handle, texture]]);
  assert.deepEqual(submit(10), ['setTexture']);
  assert.deepEqual(submit(10), ['setTexture']);
  assert.deepEqual(submit(9), ['setTexture']);                              // 离复制完成 29 毫秒
  assert.deepEqual(page.released, []);

  assert.deepEqual(submit(1), ['beginCopy']);                               // 满 30 毫秒：同一帧复制第二次
  assert.deepEqual(texture.frames, [1001n, 1001n]);
  assert.deepEqual(submit(), ['done', 'release', 'closeHandle', 'setTexture']);   // 复制过两次的帧还给宿主
  assert.deepEqual(gpu.closed, [1001n]);
  assert.deepEqual(page.released, [1]);
  assert.deepEqual(page.early, []);

  assert.deepEqual(submit(), ['setTexture']);
  assert.deepEqual(submit(100), ['setTexture']);
  assert.deepEqual(gpu.live().map(o => o.kind), ['query', 'texture']);      // 两次打开的源纹理都放掉了
});

test('帧：GPU 没复制完时什么都不做；只留最新一帧，没用上的直接还', t => {
  const { gpu, page, submit } = surfaceRig(t);
  page.send(1);
  assert.deepEqual(submit(), ['release', 'createTexture', 'beginCopy']);
  gpu.busy = true;
  assert.deepEqual(submit(), ['done']);
  assert.deepEqual(submit(), ['done']);
  page.send(2);
  assert.deepEqual(page.released, []);
  page.send(3);                                   // 2 还没用上就被 3 顶掉
  assert.deepEqual(gpu.closed, [1002n]);
  assert.deepEqual(page.released, [2]);
  assert.deepEqual(submit(100), ['done']);
  gpu.busy = false;
  assert.deepEqual(submit(), ['done', 'release', 'closeHandle', 'beginCopy']);   // 1 复制完成，换成 3
  assert.deepEqual(page.released, [2, 1]);
  assert.deepEqual(textures(gpu)[0]?.frames, [1001n, 1003n]);
  assert.deepEqual(submit(), ['done', 'release', 'setTexture']);
  assert.deepEqual(page.early, []);
});

test('帧：换帧时放掉旧的一帧，纹理尺寸没变就接着用', t => {
  const { gpu, page, submit } = surfaceRig(t);
  page.send(1);
  submit();
  assert.deepEqual(submit(), ['done', 'release', 'setTexture']);
  page.send(2);
  assert.deepEqual(submit(), ['closeHandle', 'beginCopy']);     // 1 只复制过一次就被换掉
  assert.deepEqual(gpu.closed, [1001n]);
  assert.deepEqual(page.released, [1]);
  assert.equal(textures(gpu).length, 1);
  assert.deepEqual(textures(gpu)[0]?.frames, [1001n, 1002n]);
});

test('帧：尺寸变了就重建常驻纹理，纹理的像素跟着变', t => {
  const { gpu, page, surface, logs, overlay, submit } = surfaceRig(t);
  page.send(1);
  submit();
  submit();
  assert.deepEqual(surface.size, { width: 1400, height: 700 });
  page.send(2, 1000, 500);
  assert.deepEqual(submit(), ['closeHandle', 'release', 'createTexture', 'beginCopy']);
  const [old, fresh] = textures(gpu);
  assert.ok(old && fresh);
  assert.equal(old.released, true);
  assert.deepEqual([fresh.width, fresh.height, fresh.frames], [1000, 500, [1002n]]);
  assert.deepEqual(logs, ['纹理 1400×700', '纹理 1000×500']);
  assert.deepEqual(submit(), ['done', 'release', 'setTexture']);
  assert.equal(overlay.texture, fresh);
  assert.deepEqual(surface.size, { width: 1000, height: 500 });   // 求交按纹理的尺寸换算
});

test('帧：复制出错时这一帧还给宿主，错误抛给调用方', t => {
  const { gpu, page, surface, submit } = surfaceRig(t);
  gpu.fail('createTexture', '建不出纹理');
  page.send(1);
  assert.throws(() => surface.submit(), /建不出纹理/);
  assert.deepEqual(gpu.closed, [1001n]);
  assert.deepEqual(page.released, [1]);
  gpu.fail('createTexture', null);
  gpu.fail('beginCopy', '打不开共享纹理');
  page.send(2);
  assert.throws(() => surface.submit(), /打不开共享纹理/);
  assert.deepEqual(page.released, [1, 2]);
  assert.deepEqual(submit(), []);                 // 纹理建好了但还没有完整的一帧：不交
  gpu.fail('beginCopy', null);
  gpu.fail('closeHandle', '句柄无效');           // 关句柄出错不影响还帧
  page.send(3);
  assert.deepEqual(submit(), ['beginCopy']);
  page.send(4);
  assert.deepEqual(submit(), ['done', 'release', 'closeHandle', 'beginCopy']);
  assert.deepEqual(page.released, [1, 2, 3]);
});

test('帧：换尺寸时新纹理建不出来，放掉的旧纹理不留着：不交给 SteamVR，销毁时不放第二次', t => {
  const { vr, gpu, page, surface, overlay, submit } = surfaceRig(t);
  page.send(1);
  submit();
  assert.deepEqual(submit(), ['done', 'release', 'setTexture']);   // 1400×700 的纹理已经交出去
  const [old] = textures(gpu);
  assert.ok(old);
  gpu.fail('createTexture', '显存不够');
  page.send(2, 1000, 500);
  assert.throws(() => surface.submit(), /显存不够/);
  assert.equal(old.released, true);
  assert.deepEqual(page.released, [1, 2]);                          // 这一帧还给宿主
  assert.deepEqual(page.early, []);
  gpu.fail('createTexture', null);
  assert.deepEqual(submit(), []);                                   // 手里没有纹理：不交
  assert.equal(vr.args('setTexture').length, 1);
  assert.equal(overlay.texture, old);
  assert.doesNotThrow(() => surface.dispose());
  assert.deepEqual(gpu.live(), []);
});

test('帧：换尺寸时新纹理建不出来之后再来一帧旧尺寸，重新建纹理，不拿空的目标去复制', t => {
  const { gpu, page, surface, overlay, submit } = surfaceRig(t);
  page.send(1);
  submit();
  submit();
  gpu.fail('createTexture', '显存不够');
  page.send(2, 1000, 500);
  assert.throws(() => surface.submit(), /显存不够/);
  assert.deepEqual(surface.size, { width: 1400, height: 700 });    // 没有纹理：用页面报的大小
  gpu.fail('createTexture', null);
  page.send(3);                                                     // 1400×700，和放掉的那张一样大
  assert.deepEqual(submit(), ['release', 'createTexture', 'beginCopy']);
  const copy = gpu.args('beginCopy').at(-1);
  assert.equal(copy?.[1], textures(gpu).at(-1));
  assert.notEqual(copy?.[1], null);
  assert.deepEqual(submit(), ['done', 'release', 'setTexture']);
  assert.equal(overlay.texture, textures(gpu).at(-1));
  surface.dispose();
  assert.deepEqual(gpu.live(), []);
});

test('画面变了才交(everyFrame 为假)：一次复制完成后交一次，画面没变的帧不交；隐藏后再显示时交一次', t => {
  const { vr, page, surface, submit } = surfaceRig(t, true, false);
  page.send(1);
  assert.deepEqual(submit(), ['release', 'createTexture', 'beginCopy']);
  assert.deepEqual(submit(), ['done', 'release', 'setTexture']);
  assert.deepEqual([submit(), submit()], [[], []]);                 // 没变：不交
  assert.deepEqual(submit(30), ['beginCopy']);                      // 同一帧隔 30 毫秒复制第二次
  assert.deepEqual(submit(), ['done', 'release', 'closeHandle', 'setTexture']);
  assert.deepEqual([submit(), submit(), submit()], [[], [], []]);
  assert.equal(vr.args('setTexture').length, 2);
  surface.setShown(false);
  assert.deepEqual(submit(), []);
  surface.setShown(true);
  assert.deepEqual(submit(), ['setTexture']);                       // 刚显示出来：纹理里的画面交一次
  assert.deepEqual(submit(), []);
  page.send(2);
  submit();
  assert.deepEqual(submit(), ['done', 'release', 'setTexture']);
  assert.equal(vr.args('setTexture').length, 4);
});

test('显卡的出错码：失败的 HRESULT 抛出，设备丢了的那几个抛出的是 GpuLost；成功的不抛', () => {
  for (const ok of [0, 1]) assert.doesNotThrow(() => check(ok, 'CreateQuery'));
  // E_FAIL：有符号和无符号的写法都认
  for (const hr of [-2147467259, 0x80004005]) {
    assert.throws(() => check(hr, 'CreateTexture2D'), e => e instanceof Error && !(e instanceof GpuLost) && e.message === 'CreateTexture2D 失败 0x80004005');
  }
  // 设备被移除、挂起、重置、驱动内部错误
  for (const hr of [0x887a0005, 0x887a0006, 0x887a0007, 0x887a0020, 0x887a0005 | 0]) {
    assert.equal(deviceLost(hr), true);
    assert.throws(() => check(hr, 'OpenSharedResource1'), e => e instanceof GpuLost && e.message.startsWith('OpenSharedResource1 失败 0x887a00'));
  }
  // 别的失败、没完成(S_FALSE)不算设备丢了
  for (const hr of [0, 1, -2147467259, 0x887a0001]) assert.equal(deviceLost(hr), false);
});

test('假 Gpu：设备丢了以后建对象、复制、查进度都抛出 GpuLost；放掉对象和设备照常', () => {
  const gpu = new FakeGpu();
  const query = gpu.createQuery();
  const texture = gpu.createTexture(4, 4);
  gpu.lost = true;
  for (const use of [() => gpu.createQuery(), () => gpu.createTexture(4, 4), () => gpu.beginCopy(1n, texture, query), () => gpu.done(query)]) {
    assert.throws(use, e => e instanceof GpuLost);
  }
  gpu.release(texture);
  gpu.release(query);
  assert.doesNotThrow(() => gpu.dispose());
  assert.deepEqual(gpu.live(), []);
});

test('显示、位置、宽度记在这里：变了才告诉 SteamVR；显示或隐藏没成功时状态不变，下一次再试', t => {
  const { calls, vr, surface, overlay } = surfaceRig(t, false);
  const from = calls.length;
  surface.setShown(false);                        // 本来就隐藏着
  surface.setMeters(0.8);                         // 宽度没变
  assert.equal(calls.length, from);
  surface.setShown(true);
  surface.setShown(true);
  assert.deepEqual([surface.visible, overlay.visible], [true, true]);
  const pose = at(1, 2, 3);
  surface.setPose(pose);
  surface.setPose(at(1, 2, 3));                   // 数值一样的另一份
  assert.deepEqual([surface.pose, overlay.pose], [pose, pose]);
  surface.setPose(at(1, 2, 4));
  surface.setMeters(1.2);
  surface.setMeters(1.2);
  assert.deepEqual([surface.meters, overlay.meters], [1.2, 1.2]);
  surface.setShown(false);
  assert.deepEqual(calls.slice(from).map(c => c.name), ['show', 'place', 'place', 'setWidth', 'hide']);
  assert.equal(surface.visible, false);

  vr.stuck.add('test:panel');
  surface.setShown(true);
  surface.setShown(true);
  assert.deepEqual([surface.visible, vr.args('show').length], [false, 3]);
  vr.stuck.delete('test:panel');
  surface.setShown(true);
  assert.deepEqual([surface.visible, overlay.visible], [true, true]);
  vr.stuck.add('test:panel');
  surface.setShown(false);
  assert.equal(surface.visible, true);
});

test('不显示时：页面交来的帧直接还，不交纹理；隐藏时手里的帧都还回去，做到一半的复制照样收掉', t => {
  const { gpu, page, surface, overlay, submit } = surfaceRig(t, false);
  page.send(1);
  assert.deepEqual([page.released, page.early, gpu.closed], [[1], [], [1001n]]);
  assert.deepEqual(submit(), []);
  surface.setShown(true);
  page.send(2);
  assert.deepEqual(submit(), ['release', 'createTexture', 'beginCopy']);   // 2 复制中
  page.send(3);                                                            // 3 等着
  surface.setShown(false);
  assert.deepEqual([page.released, page.early], [[1, 2, 3], []]);
  assert.deepEqual(submit(), ['done', 'release']);                         // 复制收掉，纹理不交
  assert.deepEqual(submit(100), []);
  assert.equal(overlay.texture, null);
  // 再显示：纹理里那一帧完整的画面马上交出去
  surface.setShown(true);
  assert.deepEqual(submit(), ['setTexture']);
  assert.equal(overlay.texture, textures(gpu)[0]);
});

test('纹理的像素：还没有纹理时用页面报的，页面也没报时是 0', t => {
  const { surface, page } = surfaceRig(t);
  assert.deepEqual(surface.size, { width: 1400, height: 700 });
  page.width = 0;
  page.height = 0;
  assert.deepEqual(surface.size, { width: 0, height: 0 });
});

test('销毁时还掉手里的帧，放掉悬浮窗口、纹理、源纹理、查询', t => {
  const { calls, vr, gpu, page, surface, overlay, submit } = surfaceRig(t);
  page.send(1);
  submit();            // 1 复制中
  page.send(2);        // 2 等着
  const from = calls.length;
  surface.dispose();
  assert.deepEqual(calls.slice(from).map(c => c.name), ['closeHandle', 'closeHandle', 'destroy', 'release', 'release', 'release']);
  assert.deepEqual(gpu.closed, [1001n, 1002n]);
  assert.deepEqual(page.released, [1, 2]);
  assert.deepEqual(page.early, []);
  assert.deepEqual([overlay.destroyed, surface.visible], [true, false]);
  assert.deepEqual(gpu.live(), []);
  assert.deepEqual(vr.args('destroy'), [[overlay.handle]]);
});

test('销毁之后页面才交来的帧(页面还开着，只是停画)关掉句柄并还回去，不留在销毁了的悬浮窗口手里', t => {
  const { calls, gpu, page, surface, submit } = surfaceRig(t);
  page.send(1);
  submit();
  surface.dispose();
  const from = calls.length;
  page.send(2);
  page.send(3);
  assert.deepEqual(calls.slice(from).map(c => c.name), ['closeHandle', 'closeHandle']);
  assert.deepEqual([page.released, page.early, gpu.closed], [[1, 2, 3], [], [1001n, 1002n, 1003n]]);
  // 宿主放掉的帧号对不上手里的任何一帧：不重复关
  page.drop(2);
  assert.equal(gpu.closed.length, 3);
  // 同一个页面交给新的悬浮窗口：帧走新的那个
  const next = new Surface(new FakeVr(), gpu, { key: 'test:next', name: 'Next', meters: 0.8, everyFrame: true }, page, () => undefined);
  next.setShown(true);
  page.send(4);
  assert.deepEqual([page.released, gpu.closed.length], [[1, 2, 3], 3]);
  next.dispose();
  assert.deepEqual([page.released, page.early], [[1, 2, 3, 4], []]);
});

test('销毁时 SteamVR 已经退出也照样放掉 GPU 的对象', t => {
  const { vr, gpu, page, surface, submit } = surfaceRig(t);
  page.send(1);
  submit();
  submit();
  vr.fail('destroy', 'SteamVR 已退出');
  surface.dispose();
  assert.deepEqual(gpu.live(), []);
  assert.deepEqual(page.released, [1]);
});

test('宿主放掉的帧关掉句柄，不用它也不还；别的帧号不管', t => {
  const { gpu, page, submit } = surfaceRig(t);
  page.send(1);
  assert.deepEqual(submit(), ['release', 'createTexture', 'beginCopy']);   // 1 复制中
  page.send(2);                                                            // 2 等着
  page.drop(9);
  assert.deepEqual(gpu.closed, []);
  page.drop(2);
  assert.deepEqual(gpu.closed, [1002n]);
  assert.deepEqual(submit(), ['done', 'release', 'setTexture']);           // 1 复制完成，没有新帧可换
  page.drop(1);                                                            // 正在用的一帧也被放掉：不复制第二次
  assert.deepEqual(gpu.closed, [1002n, 1001n]);
  assert.deepEqual(submit(100), ['setTexture']);
  assert.deepEqual(page.released, []);
  page.send(3);                                                            // 之后的帧照常
  assert.deepEqual(submit(), ['beginCopy']);
});

test('换页面时手里的帧还给前一个页面，之后收新页面的帧；换走的页面再交来的帧直接还', t => {
  const { gpu, page, surface, overlay, submit } = surfaceRig(t);
  page.send(1);
  submit();            // 1 复制中
  page.send(2);        // 2 等着
  const next = new Page(gpu, 'a.kb', 1400, 700, 2000n);
  surface.attach(next);
  assert.deepEqual([page.released, page.early, gpu.closed], [[1, 2], [], [1001n, 1002n]]);
  page.send(3);
  assert.deepEqual([page.released, gpu.closed], [[1, 2, 3], [1001n, 1002n, 1003n]]);
  assert.deepEqual(submit(), ['done', 'release', 'setTexture']);            // 复制到一半的画面照样完成、交出去
  next.send(4);
  assert.deepEqual(submit(), ['beginCopy']);
  assert.deepEqual(textures(gpu)[0]?.frames, [1001n, 2004n]);
  assert.equal(overlay.destroyed, false);
});

test('没有页面时不收帧，纹理的像素是 0；页面后到就收它的帧，页面没了纹理里的画面留着', t => {
  const clock = fakeClock(t);
  const vr = new FakeVr();
  const gpu = new FakeGpu();
  const surface = new Surface(vr, gpu, { key: 'test:panel', name: 'Test', meters: 0.8, everyFrame: true }, null, () => undefined);
  surface.setShown(true);
  assert.deepEqual(surface.size, { width: 0, height: 0 });
  surface.submit();
  assert.deepEqual(vr.args('setTexture'), []);
  // 页面后到：收它的帧
  const page = new Page(gpu);
  surface.attach(page);
  page.send(1, 1000, 500);
  surface.submit();
  clock.now += 10;
  surface.submit();
  assert.equal(vr.args('setTexture').length, 1);
  // 页面没了：纹理里的画面留着，像素照旧，手里的帧还回去
  surface.attach(null);
  assert.deepEqual(page.released, [1]);
  assert.deepEqual(surface.size, { width: 1000, height: 500 });
  surface.dispose();
  assert.deepEqual(gpu.live(), []);
});

// ---------- 跟着设备、待命 ----------

test('假 Vr：跟着设备的悬浮窗口记着设备序号和相对变换；站立空间里的姿态按那个设备这一刻的姿态算，设备的姿态无效时没有', () => {
  const vr = new FakeVr();
  const h = vr.overlay('a:b', 'Name');
  const o = vr.find('a:b');
  assert.ok(o);
  vr.place(h, at(1, 2, 3));
  assert.deepEqual([o.device, vr.where(o)], [null, at(1, 2, 3)]);
  vr.placeOn(h, 4, at(0, 0.1, 0));
  assert.deepEqual([o.device, o.pose, vr.where(o)], [4, at(0, 0.1, 0), null]);   // 4 号设备还没有姿态
  vr.setPose(4, at(-0.2, 1.2, -0.3));
  assert.deepEqual(vr.where(o), at(-0.2, 1.3, -0.3));
  vr.setPose(4, [-1, 0, 0, 1, 0, 1, 0, 1, 0, 0, -1, 1]);                         // 绕 Y 转 180°：相对变换里向上的 0.1 米不变
  assert.deepEqual(vr.where(o), [-1, 0, 0, 1, 0, 1, 0, 1.1, 0, 0, -1, 1]);
  vr.losePose(4);
  assert.equal(vr.where(o), null);
  vr.place(h, at(1, 2, 3));                                                      // 放回站立空间：不跟设备了
  assert.deepEqual([o.device, vr.where(o)], [null, at(1, 2, 3)]);
  assert.deepEqual(vr.args('placeOn'), [[h, 4, at(0, 0.1, 0)]]);
});

test('跟着设备(交给 SteamVR)：设备或相对变换变了才告诉 SteamVR，站立空间里的姿态每次都记；放回绝对位置、再跟设备各说一次', t => {
  const { calls, vr, surface, overlay } = surfaceRig(t, false);
  const from = calls.length;
  const names = (): string[] => calls.slice(from).map(c => c.name);
  const relative = at(0, 0.1, 0);
  surface.setRiding(1, relative, at(-0.2, 1.3, -0.3), true);
  assert.deepEqual([names(), surface.pose, overlay.device, overlay.pose], [['placeOn'], at(-0.2, 1.3, -0.3), 1, relative]);
  surface.setRiding(1, at(0, 0.1, 0), at(0.5, 1.4, -0.2), true);      // 设备动了、相对变换没变(数值一样的另一份)：不用说
  assert.deepEqual([names(), surface.pose], [['placeOn'], at(0.5, 1.4, -0.2)]);
  surface.setRiding(1, at(0, 0.2, 0), at(0.5, 1.5, -0.2), true);      // 相对变换变了
  surface.setRiding(2, at(0, 0.2, 0), at(0.5, 1.5, -0.2), true);      // 换了设备
  assert.deepEqual(names(), ['placeOn', 'placeOn', 'placeOn']);
  assert.deepEqual(vr.args('placeOn').slice(1), [[overlay.handle, 1, at(0, 0.2, 0)], [overlay.handle, 2, at(0, 0.2, 0)]]);
  // 放回站立空间里：就算和记着的姿态一样也要说(SteamVR 那边还跟着设备)
  surface.setPose(at(0.5, 1.5, -0.2));
  surface.setPose(at(0.5, 1.5, -0.2));
  assert.deepEqual([names().slice(3), overlay.device, overlay.pose], [['place'], null, at(0.5, 1.5, -0.2)]);
  // 再跟回同一个设备、同一个相对变换：也要说
  surface.setRiding(2, at(0, 0.2, 0), at(0.5, 1.5, -0.2), true);
  assert.deepEqual([names().slice(4), overlay.device], [['placeOn'], 2]);
});

test('跟着设备(自己算)：每次把算出的姿态设成绝对位置，姿态没变时不说；不调相对设备的那个调用', t => {
  const { calls, vr, surface, overlay } = surfaceRig(t, false);
  const from = calls.length;
  surface.setRiding(1, at(0, 0.1, 0), at(-0.2, 1.3, -0.3), false);
  surface.setRiding(1, at(0, 0.1, 0), at(-0.2, 1.3, -0.3), false);
  surface.setRiding(1, at(0, 0.1, 0), at(0.5, 1.4, -0.2), false);
  surface.setRiding(2, at(0, 0.3, 0), at(0.5, 1.4, -0.2), false);
  assert.deepEqual(calls.slice(from).map(c => c.name), ['place', 'place']);
  assert.deepEqual(vr.args('place'), [[overlay.handle, at(-0.2, 1.3, -0.3)], [overlay.handle, at(0.5, 1.4, -0.2)]]);
  assert.deepEqual([surface.pose, overlay.device], [at(0.5, 1.4, -0.2), null]);
});

test('待命：不显示也收帧、复制，画面变了才交纹理；显示出来时纹理里已经是最新的画面；不待命也没显示时手里的帧还回去', t => {
  const { gpu, page, surface, overlay, submit } = surfaceRig(t, false);
  surface.setStandby(true);
  assert.equal(surface.standby, true);
  page.send(1);
  assert.deepEqual(page.released, []);
  assert.deepEqual(submit(), ['release', 'createTexture', 'beginCopy']);
  assert.deepEqual(submit(), ['done', 'release', 'setTexture']);             // 隐藏着也交：SteamVR 手里的画面跟上
  assert.deepEqual([overlay.visible, overlay.texture], [false, textures(gpu)[0]]);
  assert.deepEqual([submit(), submit()], [[], []]);                          // 画面没变：隐藏着不每帧都交
  assert.deepEqual(submit(30), ['beginCopy']);
  assert.deepEqual(submit(), ['done', 'release', 'closeHandle', 'setTexture']);
  assert.deepEqual(page.released, [1]);
  surface.setShown(true);
  assert.deepEqual([submit(), submit()], [['setTexture'], ['setTexture']]);  // 显示着：每个显示帧都交
  // 隐藏回待命：手里的帧留着接着用
  page.send(2);
  surface.setShown(false);
  assert.deepEqual(page.released, [1]);
  assert.deepEqual(submit(), ['beginCopy']);
  assert.deepEqual(submit(), ['done', 'release', 'setTexture']);
  assert.deepEqual(textures(gpu)[0]?.frames, [1001n, 1001n, 1002n]);
  // 不待命了：手里的帧还回去，之后交来的直接还
  surface.setStandby(false);
  assert.deepEqual([surface.standby, page.released, page.early], [false, [1, 2], []]);
  page.send(3);
  assert.deepEqual(page.released, [1, 2, 3]);
  assert.deepEqual(submit(100), []);
  // 显示着时待命不待命都一样：隐藏时没在待命才还帧
  surface.setShown(true);
  page.send(4);
  surface.setStandby(true);
  surface.setStandby(false);
  assert.deepEqual(page.released, [1, 2, 3]);
  surface.setShown(false);
  assert.deepEqual(page.released, [1, 2, 3, 4]);
});
