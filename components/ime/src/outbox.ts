// 键盘的输出：把输入框的文字发给开着的输出组件(发送)；自动送出和 PIN 只发给收实时内容(live)的输出；
// 发之前按翻译设置翻译；打字时让输出显示「正在输入」。

import type { KeyboardSettings, MainContext, OutputPayload } from '@konkon-lab/foxpanel-sdk';
import { errorText } from '../../_shared/util.ts';

// 最后一次打字后多久撤掉「正在输入」(毫秒)
const TYPING_OFF_MS = 6000;
// 自动送出：文字停止变化多久后送出(毫秒)
const AUTO_SEND_MS = 1500;
// PIN：每隔多久重发一次输入框的文字(毫秒)
const PIN_REFRESH_MS = 2000;

export interface OutboxDeps {
  settings(): KeyboardSettings;
  text(): string;                                 // 输入框当前的文字
  output(p: OutputPayload, live: boolean): Promise<string[]>;   // 发给开着的输出组件，live = 只发收实时内容的；返回收到的组件 id
  hasLive(): boolean;                             // 有收实时内容的输出
  hasTyping(): boolean;                           // 有显示「正在输入」的输出
  typing(on: boolean): void;
  translate(text: string): Promise<string>;       // 按翻译设置翻译(关闭时原样返回)，失败时抛出异常
  log: MainContext['log'];
}

export class Outbox {
  private readonly deps: OutboxDeps;
  private typingTimer: NodeJS.Timeout | undefined;
  private autoTimer: NodeJS.Timeout | undefined;
  private pinTimer: NodeJS.Timeout | undefined;
  private failedText: string | null = null;   // 翻译失败的句子：再遇到同一句直接用原文
  private lastAutoSent: string | null = null; // 上次自动送出的文字：还是这一句时不重发；输入框变空后为 null

  constructor(deps: OutboxDeps) {
    this.deps = deps;
    this.updatePin();
  }

  stop(): void {
    clearTimeout(this.typingTimer);
    clearTimeout(this.autoTimer);
    clearInterval(this.pinTimer);
  }

  // 「正在输入」：开了提示且有输出能显示
  get showsTyping(): boolean {
    return this.deps.settings().showTyping && this.deps.hasTyping();
  }

  // 打了字：显示「正在输入」，一段时间没再打就撤掉
  typed(): void {
    if (!this.showsTyping) return;
    this.deps.typing(true);
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => { if (this.showsTyping) this.deps.typing(false); }, TYPING_OFF_MS);
  }

  // 输入框做了编辑(或自动送出的开关变了)：自动送出重新计时，文字停下来后送一次；和上次自动送出的是同一句时不送
  textChanged(): void {
    clearTimeout(this.autoTimer);
    this.autoTimer = undefined;
    if (!this.deps.text()) {
      this.lastAutoSent = null;
      return;
    }
    if (!this.autoSends) return;
    this.autoTimer = setTimeout(() => {
      const text = this.deps.text();
      if (this.autoSends && text !== this.lastAutoSent) void this.publish(text, true);
    }, AUTO_SEND_MS);
  }

  // 设置改了：wasTyping = 改之前的 showsTyping
  settingsChanged(patch: Partial<KeyboardSettings>, wasTyping: boolean): void {
    if (wasTyping && !this.showsTyping) this.deps.typing(false);
    if (patch.autoSend !== undefined) this.textChanged();
    if (patch.pinMessage !== undefined) this.updatePin();
  }

  // 发送给开着的输出(空文字 = 清空聊天框这类显示)
  send(raw: string): void {
    void this.render(raw).then(({ text, spoken }) => this.deliver({ text, spoken, notify: true }, false));
  }

  // 交给输出；交不出去时记一行警告
  private deliver(payload: OutputPayload, live: boolean): void {
    this.deps.output(payload, live).catch((e: unknown) => this.deps.log(`send failed: ${errorText(e)}`, 'warn'));
  }

  // 开了自动送出且有收实时内容的输出
  private get autoSends(): boolean {
    return this.deps.settings().autoSend && this.deps.hasLive();
  }

  // 原文和要朗读的译文；翻译失败时用原文(同一句只试一次)
  private async render(raw: string): Promise<{ text: string; spoken: string }> {
    const text = raw.trim();
    if (!text || this.failedText === text) return { text, spoken: text };
    try {
      return { text, spoken: await this.deps.translate(text) };
    } catch (e) {
      this.failedText = text;
      this.deps.log(`translate failed: ${errorText(e)}`, 'warn');
      return { text, spoken: text };
    }
  }

  // 实时内容：auto = 自动送出(带提示音，同一句只送一次)，否则是 PIN；翻译回来时输入框已经变了就不发
  private async publish(raw: string, auto: boolean): Promise<void> {
    const { text, spoken } = await this.render(raw);
    if (this.deps.text() !== raw) return;
    if (auto) {
      if (raw === this.lastAutoSent) return;
      this.lastAutoSent = raw;
    }
    this.deliver({ text, spoken, notify: auto }, true);
  }

  // PIN：开启时马上显示一次，之后定时重发；输入框为空或没有收实时内容的输出时不发
  private updatePin(): void {
    clearInterval(this.pinTimer);
    this.pinTimer = undefined;
    if (!this.deps.settings().pinMessage) return;
    const refresh = (): void => {
      const text = this.deps.text();
      if (text.trim() && this.deps.hasLive()) void this.publish(text, false);
    };
    refresh();
    this.pinTimer = setInterval(refresh, PIN_REFRESH_MS);
  }
}
