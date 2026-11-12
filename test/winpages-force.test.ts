import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, type SimLink, type SimNode } from '../components/window-deps/src/force.ts';

const node = (x = 0, y = 0): SimNode => ({ x, y, vx: 0, vy: 0, fx: null, fy: null });

// 依赖图的形状：根连着 groups 个分组，每个分组连着 each 个节点
function tree(groups: number, each: number): { nodes: SimNode[]; links: SimLink<SimNode>[] } {
  const root = node();
  const nodes = [root];
  const links: SimLink<SimNode>[] = [];
  for (let g = 0; g < groups; g++) {
    const group = node();
    nodes.push(group);
    links.push({ source: root, target: group, weight: 1 });
    for (let i = 0; i < each; i++) {
      const leaf = node();
      nodes.push(leaf);
      links.push({ source: group, target: leaf, weight: 1 });
    }
  }
  return { nodes, links };
}

// 跑到停下，返回节点外框的宽和高
function settle(sim: Simulation<SimNode>, nodes: SimNode[]): { width: number; height: number } {
  let steps = 0;
  while (sim.running) {
    sim.tick();
    assert.ok(++steps < 5000, '模拟应当自己停下');
  }
  const xs = nodes.map(n => n.x);
  const ys = nodes.map(n => n.y);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

test('力导向布局：没有位置的节点排在中心附近，已有位置的不动；跑一阵自己停下', () => {
  const sim = new Simulation<SimNode>();
  const placed = node(40, -30);
  const fresh = [node(), node(), node()];
  sim.set([placed, ...fresh], []);
  assert.deepEqual([placed.x, placed.y], [40, -30]);
  assert.ok(fresh.every(n => Number.isFinite(n.x) && Number.isFinite(n.y) && (n.x !== 0 || n.y !== 0)));
  assert.equal(new Set(fresh.map(n => `${n.x},${n.y}`)).size, 3);
  assert.ok(sim.running);
  settle(sim, [placed, ...fresh]);
  assert.ok(!sim.running);
});

test('力导向布局：连线两端收到目标长度附近；钉住的节点留在原处', () => {
  const sim = new Simulation<SimNode>();
  const a = node(-300, 0);
  const b = node(300, 0);
  a.fx = -300;
  a.fy = 0;
  sim.set([a, b], [{ source: a, target: b, weight: 1 }]);
  settle(sim, [a, b]);
  assert.deepEqual([a.x, a.y], [-300, 0]);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  assert.ok(length > 50 && length < 200, `连线长度 ${length}`);
});

test('力导向布局：画布越宽图摊得越宽，越高摊得越高；量不到大小时两个方向一样', () => {
  const shape = (width: number, height: number): number => {
    const sim = new Simulation<SimNode>();
    const g = tree(4, 6);
    sim.set(g.nodes, g.links);
    sim.resize(width, height);
    const box = settle(sim, g.nodes);
    return box.width / box.height;
  };
  const wide = shape(1600, 400);
  const tall = shape(400, 1600);
  const square = shape(800, 800);
  assert.ok(wide > square * 1.5, `宽画布 ${wide}，方画布 ${square}`);
  assert.ok(tall < square / 1.5, `高画布 ${tall}，方画布 ${square}`);
  assert.equal(shape(0, 0), square);
});

test('力导向布局：停下后 restart 让它接着动；alphaTarget 大于 0 时不停', () => {
  const sim = new Simulation<SimNode>();
  const g = tree(1, 3);
  sim.set(g.nodes, g.links);
  settle(sim, g.nodes);
  sim.restart(0.3);
  assert.ok(sim.running);
  assert.equal(sim.alpha, 0.3);
  sim.restart(0.1);
  assert.equal(sim.alpha, 0.3);
  settle(sim, g.nodes);
  sim.alphaTarget = 0.3;
  for (let i = 0; i < 3000; i++) sim.tick();
  assert.ok(sim.running);
});
