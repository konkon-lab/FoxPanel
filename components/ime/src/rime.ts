// librime 1.17 的 C 接口绑定(koffi)：初始化并部署词库、一个会话；模拟按键，取上屏文字 / 输入串 / 原始输入 / 候选，选候选；
// 经 levers 模块导入用户词库。只在输入法工作线程里用(部署会阻塞数秒)。

import type { CandidateItem } from '@konkon-lab/foxpanel-sdk';
import koffi from './koffi.ts';

const Bool = 'int';
const RimeTraits = koffi.struct('RimeTraits', {
  data_size: 'int', shared_data_dir: 'void *', user_data_dir: 'void *', distribution_name: 'void *', distribution_code_name: 'void *',
  distribution_version: 'void *', app_name: 'void *', modules: 'void *', min_log_level: 'int', log_dir: 'void *',
  prebuilt_data_dir: 'void *', staging_dir: 'void *',
});
const RimeComposition = koffi.struct('RimeComposition', { length: 'int', cursor_pos: 'int', sel_start: 'int', sel_end: 'int', preedit: 'char *' });
const RimeCandidate = koffi.struct('RimeCandidate', { text: 'char *', comment: 'char *', reserved: 'void *' });
const RimeMenu = koffi.struct('RimeMenu', {
  page_size: 'int', page_no: 'int', is_last_page: Bool, highlighted_candidate_index: 'int', num_candidates: 'int',
  candidates: 'void *', select_keys: 'char *',
});
const RimeContext = koffi.struct('RimeContext', { data_size: 'int', composition: RimeComposition, menu: RimeMenu, commit_text_preview: 'char *', select_labels: 'void *' });
const RimeCommit = koffi.struct('RimeCommit', { data_size: 'int', text: 'char *' });
const RimeIterator = koffi.struct('RimeCandidateListIterator', { ptr: 'void *', index: 'int', candidate: RimeCandidate });

// RimeApi 函数表(rime_api.h 里的顺序)：第 i 个函数在偏移 8 + 8i
const API = {
  setup: 0, initialize: 2, startMaintenance: 4, joinMaintenance: 6, createSession: 13, cleanupAllSessions: 17, processKey: 18,
  clearComposition: 20, getCommit: 21, freeCommit: 22, getContext: 23, freeContext: 24,
  setOption: 27, selectSchema: 34, simulateKeySequence: 47, findModule: 49, getInput: 69, selectCandidate: 71,
  listBegin: 75, listNext: 76, listEnd: 77,
} as const;
// RimeLeversApi 里 import_user_dict 的序号；RimeModule 里 get_api 的偏移
const LEVERS_IMPORT = 30;
const MODULE_GET_API = 32;

export interface RimePaths {
  dll: string;
  shared: string;
  user: string;
  prebuilt: string;
  staging: string;
  log: string;
}

// 结构体 data_size = sizeof - sizeof(int)
const dataSize = (t: ReturnType<typeof koffi.struct>): number => koffi.sizeof(t) - 4;

export class Rime {
  readonly lib: ReturnType<typeof koffi.load>;   // 句柄被回收时 koffi 会卸载 DLL，函数表随之失效，需一直持有
  private readonly api: unknown;
  private readonly keep: unknown[] = [];          // 传给 librime 的路径字符串会被一直引用
  private readonly protos = new Map<string, ReturnType<typeof koffi.proto>>();
  private session: bigint | number;

  // 不注册通知回调：部署线程回调 JS 时 JS 线程正在等部署结束，会死锁
  constructor(paths: RimePaths) {
    this.lib = koffi.load(paths.dll);
    this.api = this.lib.func('void * __cdecl rime_get_api()')() as unknown;
    const str = (s: string): Buffer => {
      const b = Buffer.from(`${s}\0`, 'utf8');
      this.keep.push(b);
      return b;
    };
    // min_log_level 2 = 只记错误
    const traits = {
      data_size: dataSize(RimeTraits), shared_data_dir: str(paths.shared), user_data_dir: str(paths.user),
      distribution_name: str('FoxPanel'), distribution_code_name: str('foxpanel'), distribution_version: str('1'), app_name: str('rime.foxpanel'),
      modules: null, min_log_level: 2, log_dir: str(paths.log), prebuilt_data_dir: str(paths.prebuilt), staging_dir: str(paths.staging),
    };
    this.call(API.setup, 'void __cdecl rimeSetup(RimeTraits *t)', traits);
    this.call(API.initialize, 'void __cdecl rimeInitialize(RimeTraits *t)', traits);
    this.maintain();
    this.session = this.createSession();
  }

  private maintain(): void {
    if (this.call(API.startMaintenance, 'int __cdecl rimeStartMaintenance(int full)', 1)) this.call(API.joinMaintenance, 'void __cdecl rimeJoinMaintenance()');
  }

  // 重新部署：关掉会话，检查全部方案，开一个新会话(调用方需重新选方案和开关)
  redeploy(): void {
    this.call(API.cleanupAllSessions, 'void __cdecl rimeCleanupAll()');
    try {
      this.maintain();
    } finally {
      this.session = this.createSession();
    }
  }

  private proto(decl: string): ReturnType<typeof koffi.proto> {
    let p = this.protos.get(decl);
    if (!p) {
      p = koffi.proto(decl);
      this.protos.set(decl, p);
    }
    return p;
  }

  private call(index: number, decl: string, ...args: unknown[]): unknown {
    const fn = koffi.decode(this.api, 8 + 8 * index, 'void *') as unknown;
    return koffi.call(fn, this.proto(decl), ...args) as unknown;
  }

  private createSession(): bigint | number {
    return this.call(API.createSession, 'uintptr_t __cdecl rimeCreateSession()') as bigint | number;
  }

  selectSchema(id: string): void {
    this.call(API.selectSchema, 'int __cdecl rimeSelectSchema(uintptr_t s, const char *id)', this.session, id);
  }

  setOption(name: string, on: boolean): void {
    this.call(API.setOption, 'void __cdecl rimeSetOption(uintptr_t s, const char *name, int on)', this.session, name, on ? 1 : 0);
  }

  // 一个键，name 为 keysym 名(a、space、BackSpace、Return…)
  key(name: string): void {
    this.call(API.simulateKeySequence, 'int __cdecl rimeSimulate(uintptr_t s, const char *seq)', this.session, `{${name}}`);
  }

  // 一个可打印的 ASCII 字符(keysym 和字符码相同)；返回 rime 有没有处理这个键
  char(c: string): boolean {
    return !!this.call(API.processKey, 'int __cdecl rimeProcessKey(uintptr_t s, int keycode, int mask)', this.session, c.charCodeAt(0), 0);
  }

  clear(): void {
    this.call(API.clearComposition, 'void __cdecl rimeClear(uintptr_t s)', this.session);
  }

  // 取出上屏文字；没有时返回 null
  commit(): string | null {
    const mem = koffi.alloc(RimeCommit, 1) as unknown;
    koffi.encode(mem, RimeCommit, { data_size: dataSize(RimeCommit), text: null });
    try {
      if (!this.call(API.getCommit, 'int __cdecl rimeGetCommit(uintptr_t s, void *c)', this.session, mem)) return null;
      const c = koffi.decode(mem, RimeCommit) as { text: string | null };
      this.call(API.freeCommit, 'int __cdecl rimeFreeCommit(void *c)', mem);
      return c.text ?? '';
    } finally {
      koffi.free(mem);
    }
  }

  // 显示用的输入串(拼音之间带空格)和其中的光标位置(UTF-16)；不在输入中为空
  composition(): { text: string; caret: number } {
    const mem = koffi.alloc(RimeContext, 1) as unknown;
    koffi.encode(mem, RimeContext, { data_size: dataSize(RimeContext) });
    try {
      if (!this.call(API.getContext, 'int __cdecl rimeGetContext(uintptr_t s, void *c)', this.session, mem)) return { text: '', caret: 0 };
      const ctx = koffi.decode(mem, RimeContext) as { composition: { preedit: string | null; cursor_pos: number } };
      this.call(API.freeContext, 'int __cdecl rimeFreeContext(void *c)', mem);
      const text = ctx.composition.preedit ?? '';
      // cursor_pos 是 UTF-8 字节位置
      const caret = Buffer.from(text, 'utf8').subarray(0, Math.max(0, ctx.composition.cursor_pos)).toString('utf8').length;
      return { text, caret };
    } finally {
      koffi.free(mem);
    }
  }

  // 原始输入(按下的字母)
  input(): string {
    return (this.call(API.getInput, 'const char * __cdecl rimeGetInput(uintptr_t s)', this.session) as string | null) ?? '';
  }

  // 前 limit 个候选(不分页，index 是在全部候选里的序号)；rime 按需生成，只取一部分快得多。begin 到 end 共用同一块迭代器内存
  candidates(limit: number): CandidateItem[] {
    const mem = koffi.alloc(RimeIterator, 1) as unknown;
    const out: CandidateItem[] = [];
    try {
      if (!this.call(API.listBegin, 'int __cdecl rimeListBegin(uintptr_t s, void *it)', this.session, mem)) return out;
      while (out.length < limit && this.call(API.listNext, 'int __cdecl rimeListNext(void *it)', mem)) {
        const it = koffi.decode(mem, RimeIterator) as { index: number; candidate: { text: string | null } };
        out.push({ index: it.index, text: it.candidate.text ?? '' });
      }
      this.call(API.listEnd, 'void __cdecl rimeListEnd(void *it)', mem);
      return out;
    } finally {
      koffi.free(mem);
    }
  }

  select(index: number): boolean {
    return this.call(API.selectCandidate, 'int __cdecl rimeSelect(uintptr_t s, size_t i)', this.session, index) !== 0;
  }

  // 导入用户词库(词\t编码\t次数)，返回条数，失败为 -1。
  // 会话打开着词库时无法写入：导入前关闭全部会话，导入后重建(调用方需重新选方案和选项)
  importUserDict(dict: string, file: string): number {
    this.call(API.cleanupAllSessions, 'void __cdecl rimeCleanupAll()');
    try {
      const mod = this.call(API.findModule, 'void * __cdecl rimeFindModule(const char *name)', 'levers') as unknown;
      if (!mod) throw new Error('rime.dll 中没有 levers 模块');
      const getApi = koffi.decode(mod, MODULE_GET_API, 'void *') as unknown;
      const levers = koffi.call(getApi, this.proto('void * __cdecl leversGetApi()')) as unknown;
      const fn = koffi.decode(levers, 8 + 8 * LEVERS_IMPORT, 'void *') as unknown;
      return koffi.call(fn, this.proto('int __cdecl leversImport(const char *dict, const char *file)'), dict, file) as number;
    } finally {
      this.session = this.createSession();
    }
  }
}
