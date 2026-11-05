// 主窗口组件计划的执行：首次全部加载；之后计划变了，只是某些组件的设置变了就只重新加载这几个组件，
// 组件增减或换了入口时整页重新加载。同一个组件的重新加载一个接一个做，结果总是最后一份计划；
// 首次加载完成之前推来的计划留着最后一份，加载完再处理。

import type { CodeComponent } from '../shared/types.ts';

export interface PlanDeps {
  load(c: CodeComponent, index: number): Promise<void>;   // 加载一个组件；加载失败由它自己记日志，不抛出
  unload(id: string): Promise<void>;                       // 卸载一个组件；没加载着时什么都不做
  reloadPage(): void;                                      // 整页重新加载
  failed(id: string, e: unknown): void;                    // 重新加载一个组件时出了错
}

export interface PlanRunner {
  start(first: CodeComponent[]): Promise<void>;   // 首次加载，全部组件加载完才返回
  next(plan: CodeComponent[]): void;              // 主进程推来的新计划
}

export function createPlanRunner(deps: PlanDeps): PlanRunner {
  let plan: CodeComponent[] = [];
  let started = false;                                // 首次加载完了
  let held: CodeComponent[] | null = null;            // 首次加载完成之前到的最后一份计划
  const queues = new Map<string, Promise<void>>();   // 组件 id → 它排着的重新加载
  const wanted = new Map<string, CodeComponent>();   // 组件 id → 最后要加载成的那一份

  // 排一次重新加载；轮到时已经有更新的一份在后面排着就跳过。卸载旧的出错也照样加载新的
  const reload = (c: CodeComponent, index: number): void => {
    wanted.set(c.id, c);
    queues.set(c.id, (queues.get(c.id) ?? Promise.resolve()).then(async () => {
      if (wanted.get(c.id) !== c) return;
      await deps.unload(c.id).catch((e: unknown) => deps.failed(c.id, e));
      await deps.load(c, index);
    }).catch((e: unknown) => deps.failed(c.id, e)));
  };

  const apply = (next: CodeComponent[]): void => {
    const same = next.length === plan.length && next.every((c, i) => c.id === plan[i]?.id && c.url === plan[i]?.url);
    if (!same) return deps.reloadPage();
    const changed = next.map((c, i) => [c, i] as const).filter(([c, i]) => JSON.stringify(c.config) !== JSON.stringify(plan[i]?.config));
    plan = next;
    for (const [c, i] of changed) reload(c, i);
  };

  return {
    async start(first) {
      plan = first;
      await Promise.all(first.map((c, i) => deps.load(c, i)));
      started = true;
      if (held) apply(held);
      held = null;
    },
    next(p) {
      if (started) apply(p);
      else held = p;
    },
  };
}
