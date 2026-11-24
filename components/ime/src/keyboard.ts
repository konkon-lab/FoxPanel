// VR 键盘的输入：键盘面板发来的键位按当前语言包和模式处理——rime 方案交给 rime(工作线程)，内置韩文自己拼字，
// 直接打字母的模式直接插入；上屏文字插入输入框。发送、自动送出、PIN 在 outbox.ts。
// 会改输入状态的入口(act、setMode、refresh、dictated、dictationEnded、importSogou、部署前后的切换)排成一队依次执行：
// 一个键要等 rime 回来才有结果，下一个键得在那之后看状态。私有方法都在队里执行，不能再调这些入口等同一队(会卡死)。

import type { CandidateItem, IdleKey, ImePack, KeyCode, KeyboardAction, KeyboardSettings, KeyboardState, PackMode, UiLang } from '@konkon-lab/foxpanel-sdk';
import { errorText } from '../../_shared/util.ts';
import { isIdleKey } from '../../_shared/keyboard.ts';
import type { SogouImport } from './channels.ts';
import type { ImePort } from './client.ts';
import { jamoOf } from './hangul.ts';
import { HanjaDict } from './hanja.ts';
import { currentPack, modeOf, PINYIN_SCHEMA } from './imepack.ts';
import { keyMeaning, type KeyMeaning } from './keys.ts';
import { KoreanInput, type KoCandidate } from './korean.ts';
import { Outbox, type OutboxDeps } from './outbox.ts';
import type { ImeResult, SessionRequest } from './protocol.ts';
import type { RimePaths } from './rime.ts';
import { findSogouUserDict, importSogouDict } from './sogou.ts';
import { TextBuffer } from './text.ts';

// VRChat 聊天框显示不了 emoji，不放进候选
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
// Tab 键插入的文字
const TAB = '    ';
// 输入串里的编辑键 → rime 键名
const RIME_EDIT: Partial<Record<KeyCode, string>> = {
  Backspace: 'BackSpace', Delete: 'Delete', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Home', Home: 'Home', ArrowDown: 'End',
};
// 结束输入时最多按几次空格：第一次上屏第一个候选，之后每次上屏一段没有候选的输入
const COMMIT_SPACES = 8;

// rime 的状态：没启动 / 部署中 / 能用 / 初始化失败(之后一直不能用)
export type EngineState = 'off' | 'starting' | 'ready' | 'failed';

export interface KeyboardDeps extends Omit<OutboxDeps, 'text'> {
  save(patch: Partial<KeyboardSettings>): void;
  sogouImported(count: number): void;             // 搜狗词库导入完成，count = 条数
  clearOutputs(): void;                           // 清除各输出显示的内容
  idleKey(key: IdleKey, repeat: boolean): void;   // 输入框空着时按了退格或方向键；repeat = 按住连发的
  setOutput(id: string, on: boolean): void;       // 开关一个组件；只拿 outputs() 里的 id 调
  outputs(): KeyboardState['outputs'];            // 装着的输出组件
  dictate(on: boolean): void;                     // 开关听写
  clipboard: { read(): Promise<string>; write(text: string): void };
  canDictate(): boolean;                          // 有输入源接了听写
  broadcast(state: KeyboardState): void;
  ime: ImePort;                                   // 输入法工作线程
  rimePaths: RimePaths;
  hanjaFile: string;                              // 韩文汉字词库
  packs(): readonly ImePack[];                    // 开着的语言，按语言面板顺序
  uiLang(): UiLang;                               // 键盘上文字的语言
}

// 平假名 → 片假名(两个区块里同一个音相差 0x60)
const toKatakana = (s: string): string => s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));

// 数字键选第几个候选(从 0 数)：1–9 是前九个，0 是第十个
const candidateIndex = (digit: string): number => (Number(digit) || 10) - 1;

export class KeyboardService {
  private readonly deps: KeyboardDeps;
  private readonly ime: ImePort;
  private readonly outbox: Outbox;
  private readonly buf = new TextBuffer();
  private readonly hanjaDict: HanjaDict;
  private readonly ko: KoreanInput;
  private koCandidates: KoCandidate[] = [];
  private engine: EngineState = 'off';
  private lang = '';                           // 当前语言包；空 = 还没定
  private composition = '';                    // 显示用的输入串
  private compositionCaret = 0;
  private candidates: CandidateItem[] = [];
  private dictating = false;
  private dictation = '';
  private heldOutside = false;                // 这一次按住的退格或方向键 是从输入框空着时开始的
  private ops: Promise<unknown> = Promise.resolve();       // 操作队列的末尾
  private deploys: Promise<void> = Promise.resolve();      // 部署(初始化、重新部署)队列的末尾

  constructor(deps: KeyboardDeps) {
    this.deps = deps;
    this.ime = deps.ime;
    this.hanjaDict = new HanjaDict(deps.hanjaFile);
    this.ko = new KoreanInput(this.hanjaDict);
    this.outbox = new Outbox({ ...deps, text: () => this.buf.text });
  }

  get engineState(): EngineState {
    return this.engine;
  }

  // 初始化 rime 并部署词库(首次较慢)，然后按设置定当前语言。
  // 部署期间的状态(没就绪；语言包、界面语言、设置已有)在开始时推一次
  start(): Promise<void> {
    if (this.engine !== 'off') return this.deploys;
    this.engine = 'starting';
    this.refresh();
    return this.deploy(async () => {
      let ok = true;
      try {
        await this.ime.request({ kind: 'init', paths: this.deps.rimePaths, schema: this.schema, switches: this.mode.switches ?? {} });
        this.deps.log('ime ready');
      } catch (e) {
        ok = false;
        this.deps.log(`ime init failed: ${errorText(e)}`, 'error');
      }
      await this.enqueue(() => {
        this.engine = ok ? 'ready' : 'failed';
        return this.useCurrent();
      });
    });
  }

  // 语言包装上或卸载后：重新部署 rime，再按设置定当前语言。rime 没启动或初始化失败时只定当前语言
  redeploy(): Promise<void> {
    return this.deploy(async () => {
      if (this.engine !== 'ready') return this.enqueue(() => this.useCurrent());
      await this.enqueue(async () => {
        await this.discard();
        this.engine = 'starting';
        this.emit();
      });
      try {
        await this.ime.request({ kind: 'deploy' });
        this.deps.log('ime redeployed');
      } catch (e) {
        this.deps.log(`ime redeploy failed: ${errorText(e)}`, 'error');
      }
      // 部署失败时工作线程也重建了会话，rime 照样能用
      await this.enqueue(() => {
        this.engine = 'ready';
        return this.useCurrent();
      });
    });
  }

  stop(): void {
    this.outbox.stop();
    this.ime.stop();
  }

  // ---------- 排队 ----------

  // 排到操作队列末尾执行，返回它的结果；前面的操作失败不影响后面的
  private enqueue<T>(op: () => T | Promise<T>): Promise<T> {
    const p = this.ops.then(op);
    this.ops = p.catch(() => undefined);
    return p;
  }

  // 排队执行、不等结果的操作：出错记日志
  private background(op: () => void | Promise<void>): void {
    void this.enqueue(op).catch((e: unknown) => this.deps.log(`ime: ${errorText(e)}`, 'error'));
  }

  // 部署一个个来。等 rime 部署的那几秒不占操作队列：按键照常处理，用到 rime 的不生效
  private deploy(step: () => Promise<void>): Promise<void> {
    this.deploys = this.deploys.then(step).catch((e: unknown) => this.deps.log(`ime deploy: ${errorText(e)}`, 'error'));
    return this.deploys;
  }

  // ---------- 状态 ----------

  private snapshot(): KeyboardState {
    return {
      ready: this.engine === 'ready', lang: this.lang, uiLang: this.deps.uiLang(), packs: [...this.deps.packs()], pack: this.pack, mode: this.mode,
      text: this.buf.text, caret: this.buf.caret, selStart: this.buf.selStart, selEnd: this.buf.selEnd,
      composition: this.composition, compositionCaret: this.compositionCaret, candidates: this.candidates, dictating: this.dictating, dictation: this.dictation,
      canDictate: this.deps.canDictate(), outputs: this.deps.outputs(),
      settings: this.deps.settings(),
    };
  }

  private emit(): void {
    this.deps.broadcast(this.snapshot());
  }

  // 语言开关、顺序、界面语言、输出变了：重新定当前语言(关掉了就用第一个开着的)，把新状态推出去
  refresh(): void {
    this.background(() => this.useCurrent());
  }

  // ---------- 语言包 ----------

  // 当前语言包：还没定时按设置，关掉或卸载了时用第一个开着的
  private get pack(): ImePack {
    return currentPack(this.deps.packs(), this.lang || this.deps.settings().lang);
  }

  private get mode(): PackMode {
    return modeOf(this.pack, this.deps.settings().modes);
  }

  private get korean(): boolean {
    return this.pack.engine === 'hangul';
  }

  private get hanja(): boolean {
    return this.korean && this.mode.id === 'hanja';
  }

  // 当前用的 rime 方案；直接打字母和韩文为 null
  private get schema(): string | null {
    if (this.korean || this.mode.direct) return null;
    return this.mode.schema ?? this.pack.schema;
  }

  // 不出候选的模式(日语平假名 / 片假名)：上屏输入串
  private get kana(): boolean {
    return !!this.mode.output && !!this.schema;
  }

  private get katakana(): boolean {
    return this.kana && this.mode.output === 'katakana';
  }

  private get composing(): boolean {
    return this.composition !== '';
  }

  // 切换语言或模式；关着的包不能切
  private async setLang(lang: string, mode?: string): Promise<void> {
    const pack = this.deps.packs().find(p => p.id === lang);
    if (!pack) return;
    const modes = { ...this.deps.settings().modes };
    if (mode !== undefined && pack.modes.some(m => m.id === mode)) modes[lang] = mode;
    this.deps.save({ lang, modes });
    await this.useCurrent();
  }

  // 按设置定当前语言包和模式：换了包时丢弃没打完的输入；rime 的语言选方案和开关；最后推一次状态
  private async useCurrent(): Promise<void> {
    const pack = currentPack(this.deps.packs(), this.deps.settings().lang);
    if (pack.id !== this.lang) {
      await this.discard();
      this.lang = pack.id;
    }
    this.ko.hanja = this.hanja;
    if (this.hanja) void this.hanjaDict.preload().catch((e: unknown) => this.deps.log(`hanja dict: ${errorText(e)}`, 'warn'));
    const schema = this.schema;
    if (schema) await this.ask({ kind: 'schema', id: schema, switches: this.mode.switches ?? {} });
    else if (this.korean) this.updateKorean();
    else if (this.composing) await this.ask({ kind: 'clear' });
    this.emit();
  }

  // ---------- rime ----------

  private apply(r: ImeResult): void {
    this.composition = this.katakana ? toKatakana(r.composition) : r.composition;
    this.compositionCaret = r.compositionCaret;
    this.candidates = this.kana ? [] : r.candidates.filter(c => !EMOJI.test(c.text));
    if (r.commit) this.insert(this.katakana ? toKatakana(r.commit) : r.commit, false);
    this.emit();
  }

  // 发请求并应用结果，返回结果；rime 不能用或出错返回 null
  private async ask(req: SessionRequest): Promise<ImeResult | null> {
    if (this.engine !== 'ready') return null;
    try {
      const r = await this.ime.request(req);
      this.apply(r);
      return r;
    } catch (e) {
      this.deps.log(`ime: ${errorText(e)}`, 'warn');
      return null;
    }
  }

  // 结束输入：上屏第一个候选(剩下没有候选的部分也一起上屏)；
  // 不出候选的模式上屏输入串；韩文上屏整个输入串
  private async commitFirst(): Promise<void> {
    if (!this.composing) return;
    if (this.korean) return this.insert(this.flushKorean());
    if (this.kana) {
      const kana = this.composition;
      await this.ask({ kind: 'clear' });
      return this.insert(kana);
    }
    for (let i = 0; i < COMMIT_SPACES && this.composing; i++) {
      await this.ask({ kind: 'key', name: 'space' });
      if (this.candidates.length) break;
    }
  }

  // 丢弃没打完的输入。按在拼的是不是韩文分，不按当前语言：韩文被关掉时当前语言已经是别的了
  private async discard(): Promise<void> {
    if (this.ko.composition) {
      this.ko.flush();
      this.updateKorean();
    } else if (this.composing) {
      await this.ask({ kind: 'clear' });
    }
  }

  // ---------- 韩文 ----------

  private updateKorean(): void {
    this.koCandidates = this.ko.candidates();
    this.composition = this.ko.composition;
    this.compositionCaret = this.composition.length;
    this.candidates = this.koCandidates.map((c, index) => ({ index, text: c.text }));
  }

  private flushKorean(): string {
    const text = this.ko.flush();
    this.updateKorean();
    return text;
  }

  private koreanKey(code: KeyCode, m: KeyMeaning | null, shift: boolean): Promise<void> | void {
    const jamo = m?.letter ? jamoOf(m.char, shift) : null;
    if (jamo) {
      const done = this.ko.letter(jamo);
      this.updateKorean();
      return done ? this.insert(done) : this.emit();
    }
    if (m?.digit && this.candidates.length) return this.select(candidateIndex(m.char));
    if (m) return this.insert(this.flushKorean() + m.char);
    if (code === 'Backspace' && this.ko.backspace()) {
      this.updateKorean();
      return this.emit();
    }
    if (code === 'Enter' && this.composing) return this.insert(this.flushKorean());
    const pending = this.flushKorean();
    if (pending) this.insert(pending, false);
    return this.editKey(code);
  }

  // ---------- 文字 ----------

  private insert(s: string, emit = true): void {
    this.buf.insert(s);
    this.changed(emit);
  }

  // 输入框的文字变了
  private changed(emit = true): void {
    this.outbox.textChanged();
    if (emit) this.emit();
  }

  private async clean(): Promise<void> {
    this.buf.clear();
    await this.discard();
    this.changed();
  }

  // 发送输入框的文字(空的也发：清空聊天框这类显示)；开着 PIN 时文字留在输入框
  private async send(): Promise<void> {
    await this.commitFirst();
    this.outbox.send(this.buf.text);
    if (!this.deps.settings().pinMessage) await this.clean();
  }

  // ---------- 页面操作 ----------

  act(a: KeyboardAction): Promise<void> {
    return this.enqueue(() => this.handle(a));
  }

  private async handle(a: KeyboardAction): Promise<void> {
    switch (a.kind) {
      case 'key':
        if (isIdleKey(a.code)) this.idlePressed(a.code, a.repeat === true);
        return this.key(a.code, a.shift);
      case 'text':
        this.outbox.typed();
        await this.commitFirst();
        return this.insert(a.text);
      case 'select': return this.select(a.index);
      case 'caret':
        this.buf.moveTo(a.position);
        break;
      case 'range':
        this.buf.select(a.start, a.end);
        break;
      case 'paste': {
        const text = await this.deps.clipboard.read();
        if (text) this.insert(text.replace(/\r?\n/g, ' '));
        return;
      }
      case 'copy':
        this.deps.clipboard.write(this.buf.hasSelection ? this.buf.selected : this.buf.text);
        return;
      case 'clear': return this.clean();
      case 'send': return this.send();
      case 'dictate':
        this.dictating = !this.dictating && this.deps.canDictate();
        this.deps.dictate(this.dictating);
        this.dictation = '';
        break;
      case 'clearOutputs':
        this.deps.clearOutputs();
        return;
      case 'output':
        // 只开关装着的输出组件：页面发来的 id 是别的组件或不存在时不做
        if (this.deps.outputs().some(o => o.id === a.id)) this.deps.setOutput(a.id, a.on);
        return;
      case 'lang': return this.setLang(a.lang, a.mode);
      case 'settings': return this.updateSettings(a.patch);
    }
    this.emit();
  }

  // 输入框空着时的退格、方向键 通知出去。按下时还有字的，这一次按住删空了也不通知
  private idlePressed(key: IdleKey, repeat: boolean): void {
    const empty = !this.buf.text && !this.composing && !this.dictation;
    if (!repeat || !empty) this.heldOutside = empty;
    if (empty && this.heldOutside) this.deps.idleKey(key, repeat);
  }

  private async select(index: number): Promise<void> {
    if (!this.korean) {
      await this.ask({ kind: 'select', index });
      return;
    }
    const c = this.koCandidates[index];
    if (!c) return;
    const text = this.ko.pick(c);
    this.updateKorean();
    this.insert(text);
  }

  // 一个键：按当前语言分给韩文、直接打字母、rime；rime 里可打字的键和编辑键分开处理
  private async key(code: KeyCode, shift: boolean): Promise<void> {
    this.outbox.typed();
    if (code === 'Tab') {
      // Tab = 四个空格，输入中的内容上屏后插入
      await this.commitFirst();
      return this.insert(TAB);
    }
    const m = keyMeaning(code, shift);
    if (this.korean) return this.koreanKey(code, m, shift);
    if (!this.schema) return m ? this.insert(m.char) : this.editKey(code);
    if (m) return this.pack.latin ? this.typeLatin(m) : this.typeInRime(m, shift);
    return this.composing ? this.editInRime(code) : this.editKey(code);
  }

  // 拼音文字(英文单词)：字母进输入串；空格、数字、符号在单词上屏后插入
  private async typeLatin(m: KeyMeaning): Promise<void> {
    if (m.letter) {
      await this.ask({ kind: 'key', name: m.char });
      return;
    }
    await this.commitFirst();
    this.insert(m.char);
  }

  // rime 方案里一个可打字的键
  private async typeInRime(m: KeyMeaning, shift: boolean): Promise<void> {
    const space = m.char === ' ';
    if (m.digit && this.composing) {
      // 输入中按数字：选第几个候选；没有候选(假名模式)时输入串上屏后插入数字
      const c = this.candidates[candidateIndex(m.char)];
      if (c) {
        await this.ask({ kind: 'select', index: c.index });
        return;
      }
      if (this.candidates.length) return;
      await this.commitFirst();
      return this.insert(m.char);
    }
    if (m.digit || (space && !this.composing)) return this.insert(m.char);
    if (space) return this.commitFirst();
    if (m.letter && shift) {
      // 大写字母直接插入，输入中的内容在它前面上屏
      await this.commitFirst();
      return this.insert(m.char);
    }
    if (m.letter) {
      await this.ask({ kind: 'key', name: m.char });
      return;
    }
    // 符号：假名模式下假名上屏，不转汉字；方案里没有的符号 rime 不处理，照原样插入
    if (this.kana) await this.commitFirst();
    const r = await this.ask({ kind: 'char', char: m.char });
    if (r && !r.handled) this.insert(m.char);
  }

  // 输入中的回车和编辑键
  private async editInRime(code: KeyCode): Promise<void> {
    if (code === 'Enter') {
      // 不出候选的模式上屏输入串；其余按语言包：交给 rime(日语上屏假名)或上屏字母
      if (this.kana) return this.commitFirst();
      await this.ask(this.pack.enter === 'rime' ? { kind: 'key', name: 'Return' } : { kind: 'raw' });
      return;
    }
    const name = RIME_EDIT[code];
    if (name) await this.ask({ kind: 'key', name });
  }

  // 输入框里的编辑键
  private editKey(code: KeyCode): Promise<void> | void {
    switch (code) {
      case 'Backspace': this.buf.backspace(); return this.changed();
      case 'Delete': this.buf.deleteForward(); return this.changed();
      case 'Enter': return this.send();
      case 'ArrowLeft': this.buf.step(-1); break;
      case 'ArrowRight': this.buf.step(1); break;
      case 'ArrowUp': case 'Home': this.buf.moveTo(0); break;
      case 'ArrowDown': this.buf.moveTo(this.buf.text.length); break;
      default: return;
    }
    this.emit();
  }

  // 改一种语言的模式(主窗口的语言详情)：排到队里才读各语言的模式，排在前面的模式改动不会被盖掉
  setMode(lang: string, mode: string): void {
    this.background(() => this.updateSettings({ modes: { ...this.deps.settings().modes, [lang]: mode } }));
  }

  private async updateSettings(patch: Partial<KeyboardSettings>): Promise<void> {
    const wasTyping = this.outbox.showsTyping;
    this.deps.save(patch);
    this.outbox.settingsChanged(patch, wasTyping);
    // 当前语言或某个语言的模式变了
    if (patch.modes !== undefined || patch.lang !== undefined) await this.useCurrent();
    else this.emit();
  }

  // ---------- 听写 ----------

  // 听写结果：没说完的一句只显示，说完的插入到光标处
  dictated(text: string, final: boolean): void {
    this.background(() => {
      if (!this.dictating) return;
      if (!final) {
        this.dictation = text;
        return this.emit();
      }
      this.dictation = '';
      const t = text.trim();
      if (!t) return this.emit();
      this.outbox.typed();
      this.insert(t);
    });
  }

  // 麦克风或识别在别处停了：听写跟着结束
  dictationEnded(): void {
    this.background(() => {
      if (!this.dictating) return;
      this.dictating = false;
      this.dictation = '';
      this.emit();
    });
  }

  // ---------- 搜狗词库 ----------

  // 把本机搜狗用户词库导入拼音的 rime 用户词库
  importSogou(): Promise<SogouImport> {
    return this.enqueue(async (): Promise<SogouImport> => {
      if (this.engine !== 'ready') return { ok: false, error: '输入法尚未就绪' };
      const src = findSogouUserDict();
      if (!src) return { ok: false, error: '未找到搜狗用户词库' };
      try {
        // 导入时 rime 会重建会话，没打完的输入串随之没了：导入前丢弃
        if (!this.korean && this.composing) await this.ask({ kind: 'clear' });
        const count = await importSogouDict(src, this.deps.rimePaths.staging, file => this.ime.importDict(PINYIN_SCHEMA, file));
        if (count < 0) return { ok: false, error: 'rime 导入失败' };
        this.deps.sogouImported(count);
        this.deps.log(`imported ${count} words from sogou (${src})`);
        return { ok: true, count };
      } catch (e) {
        this.deps.log(`sogou import failed: ${errorText(e)}`, 'warn');
        return { ok: false, error: errorText(e) };
      } finally {
        this.emit();
      }
    });
  }
}
