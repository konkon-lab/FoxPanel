import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DEFAULT_SETTINGS, emptyLayout } from '../components/_shared/panels/layout.ts';
import { Control } from '../components/steamvr/src/control.ts';
import { useOpenVrDll } from '../components/steamvr/src/openvr.ts';
import { Session } from '../components/steamvr/src/session.ts';
import { Stage } from '../components/steamvr/src/stage.ts';

test('探测 SteamVR：一直连不上时同一个错误只记一次，状态不变', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  useOpenVrDll(path.join(import.meta.dirname, 'no-such-dir', 'openvr_api.dll'));   // 不存在的库，加载就失败
  const logs: { text: string; level: string | undefined }[] = [];
  let changed = 0;
  const board = new Control({
    serve: () => ({ active: true, watch: () => () => undefined, publish: () => undefined, close: () => undefined }),
    storage: { set: () => Promise.resolve() },
    log: () => undefined,
    display: 'SteamVR',
    settings: DEFAULT_SETTINGS,
    list: () => [],
    connected: () => false,
    report: () => undefined,
  }, emptyLayout(true));
  const stage = new Stage({ board, open: () => { throw new Error('连不上时不该开页面'); }, log: () => undefined, everyFrame: true, native: true });
  // 不给连接方式：用原生的 openvr_api.dll
  const vr = new Session({
    log: (text, level) => { logs.push({ text, level }); },
    stage, board,
    hit: { check: false, native: false },
    changed: () => { changed++; },
    actionManifest: '',
    appManifest: '',
    pointerImage: '',
  });
  vr.start();
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.level, 'error');
  assert.match(logs[0]?.text ?? '', /^vr: /);
  t.mock.timers.tick(5000 * 3);   // 之后的三次探测
  assert.equal(logs.length, 1);
  assert.equal(vr.connected, false);
  assert.equal(changed, 0);
  vr.stop();
  assert.equal(logs.length, 1);   // 没连上过，停止时不记「断开」
});
