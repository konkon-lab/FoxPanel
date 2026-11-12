import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 用仓库里的源码查：依赖图页面根节点上列的宿主服务，和宿主实际给组件的对得上。

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts: string[]): string => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

// 源码里 root.provide('名字', …) 的名字
const provided = (text: string): string[] => [...text.matchAll(/\broot\.provide\(\s*'([^']+)'/g)].flatMap(m => (m[1] ? [m[1]] : []));

test('依赖图：宿主服务的名单是页面宿主根上提供的服务加远程服务通道 relay；组件进程根上不提供服务', () => {
  const listed = /const HOST_SERVICES = \[([^\]]*)\]/.exec(read('components', 'window-deps', 'src', 'DepsPage.vue'))?.[1] ?? assert.fail('DepsPage.vue 里没有 HOST_SERVICES');
  const names = [...listed.matchAll(/'([^']+)'/g)].flatMap(m => (m[1] ? [m[1]] : []));
  const page = provided(read('src', 'panel', 'main.ts'));
  assert.deepEqual(page.sort(), ['i18n', 'overlay']);
  assert.deepEqual(provided(read('src', 'component-host', 'main.ts')), []);
  // relay 是每个组件上下文上的，页面和主进程组件都有
  for (const file of [['src', 'panel', 'services.ts'], ['src', 'component-host', 'main.ts']]) assert.match(read(...file), /\brelay\b/);
  assert.deepEqual([...names].sort(), [...page, 'relay'].sort());
});
