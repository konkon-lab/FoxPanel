// 输入法工作线程：独占 librime，一次处理一个请求，回传上屏文字、输入串和候选。

import { parentPort } from 'node:worker_threads';
import { errorText } from '../../_shared/util.ts';
import { Rime } from './rime.ts';
import type { ImeMessage, ImeRequest, ImeResult } from './protocol.ts';

// 一次最多取多少个候选：单个声母、单个字母有几千个，全取会让每次按键都卡
const MAX_CANDIDATES = 200;

let rime: Rime | null = null;
let schema: string | null = null;   // 当前选的方案；null = 没选过(会话停在 rime 的默认方案)
let switches: Record<string, boolean> = {};

function state(r: Rime, commit = r.commit()): ImeResult {
  const { text, caret } = r.composition();
  return { commit, composition: text, compositionCaret: caret, candidates: text ? r.candidates(MAX_CANDIDATES) : [] };
}

function setSwitches(r: Rime): void {
  for (const [name, on] of Object.entries(switches)) r.setOption(name, on);
}

// 新会话(初始化、重新部署、导入词库之后)：选回当前方案和开关
function useSchema(r: Rime): void {
  if (schema !== null) r.selectSchema(schema);
  setSwitches(r);
}

function handle(req: ImeRequest): ImeResult | { count: number } {
  if (req.kind === 'init') {
    rime = new Rime(req.paths);
    schema = req.schema;
    switches = req.switches;
    useSchema(rime);
    return state(rime);
  }
  const r = rime;
  if (!r) throw new Error('输入法未初始化');
  switch (req.kind) {
    case 'schema':
      // 同一个方案只设开关(如简繁)，不打断输入
      if (req.id !== schema) {
        r.clear();
        schema = req.id;
        r.selectSchema(schema);
      }
      switches = req.switches;
      setSwitches(r);
      return state(r, null);
    case 'deploy':
      r.redeploy();
      useSchema(r);
      return state(r, null);
    case 'key':
      r.key(req.name);
      return state(r);
    case 'char': {
      const handled = r.char(req.char);
      return { ...state(r), handled };
    }
    case 'select':
      r.select(req.index);
      return state(r);
    case 'raw': {
      const raw = r.input();
      r.clear();
      return state(r, raw || null);
    }
    case 'clear':
      r.clear();
      return state(r, null);
    case 'importDict': {
      const count = r.importUserDict(req.dict, req.file);
      useSchema(r);
      return { count };
    }
  }
}

parentPort?.on('message', (msg: { id: number; req: ImeRequest }) => {
  let reply: ImeMessage;
  try {
    reply = { id: msg.id, ok: handle(msg.req) };
  } catch (e) {
    reply = { id: msg.id, error: errorText(e) };
  }
  parentPort?.postMessage(reply);
});
