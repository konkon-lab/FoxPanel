import test from 'node:test';
import assert from 'node:assert/strict';
import { REMOVE, targetValues } from '../components/window-packages/src/targets.ts';

test('依赖管理：目标版本是当前版本或仓库里的各版本，最后能选移除', () => {
  const versions = { 'foxpanel-component-demo': ['1.2.0', '1.1.0', '1.0.0'] };
  assert.deepEqual(targetValues({ id: 'someone.demo', npm: 'foxpanel-component-demo', version: '1.1.0' }, versions), ['1.2.0', '1.1.0', '1.0.0', REMOVE]);
  assert.deepEqual(targetValues({ id: 'someone.other', npm: 'foxpanel-component-other', version: '0.3.0' }, versions), ['0.3.0', REMOVE]);
  assert.deepEqual(targetValues({ id: 'yanuo.osc', version: '1.0.0' }, versions), ['1.0.0', REMOVE]);
});

test('依赖管理：保护名单里的组件(外壳、组件管理)没有移除', () => {
  for (const id of ['yanuo.window-shell', 'yanuo.window-components']) {
    assert.deepEqual(targetValues({ id, version: '1.0.0' }, {}), ['1.0.0']);
    assert.deepEqual(targetValues({ id, npm: 'pkg', version: '1.0.0' }, { pkg: ['2.0.0', '1.0.0'] }), ['2.0.0', '1.0.0']);
  }
});
