// OSC 服务组件：提供 osc 服务(订阅 VRChat 发来的地址、发往 VRChat)。有订阅或开了转发时开接收(OSCQuery 或固定端口)，
// 收到的包原样转发到设置的本机端口；状态栏上报接收状态和最近一小时发出的消息数。

import dgram from 'node:dgram';
import type { MainContext, OscArg, OscService, StatusItem, Text } from '@konkon-lab/foxpanel-sdk';
import { errorText } from '../../_shared/util.ts';
import { encodeMessage, type OscMessage } from './codec.ts';
import { OscLink } from './link.ts';

const LIVE_MS = 3000;        // 这么久内收到过包算在接收
const STATUS_MS = 2000;      // 状态栏刷新间隔
const RETRY_MS = 10_000;     // 接收开不起来时隔多久重试
const HOUR_MS = 3600_000;    // 发送数统计的时间窗：一小时
const LOCAL = '127.0.0.1';   // VRChat 和转发目标都在本机
const RECEIVE_PORT = 9001;   // VRChat 默认发出的端口
const SEND_PORT = 9000;      // VRChat 默认接收的端口

const T = {
  idle: { 'zh-Hans': '没有组件用到', 'zh-Hant': '沒有元件用到', ja: '使うコンポーネントなし', en: 'Not in use', ko: '사용하는 컴포넌트 없음' },
  waiting: { 'zh-Hans': '等待 VRChat', 'zh-Hant': '等待 VRChat', ja: 'VRChat を待機中', en: 'Waiting for VRChat', ko: 'VRChat 대기 중' },
  receiving: { 'zh-Hans': '接收中', 'zh-Hant': '接收中', ja: '受信中', en: 'Receiving', ko: '수신 중' },
  recv: { 'zh-Hans': '接收', 'zh-Hant': '接收', ja: '受信', en: 'Receive', ko: '수신' },
  send: { 'zh-Hans': '发送', 'zh-Hant': '傳送', ja: '送信', en: 'Send', ko: '송신' },
  msgs: { 'zh-Hans': '消息', 'zh-Hant': '訊息', ja: 'メッセージ', en: 'Messages', ko: '메시지' },
  fixed: { 'zh-Hans': '固定端口 {p}', 'zh-Hant': '固定連接埠 {p}', ja: '固定ポート {p}', en: 'Fixed port {p}', ko: '고정 포트 {p}' },
} satisfies Record<string, Text>;

// 文案里的 {p} 换成端口号
const fill = (t: Record<string, string>, p: number): Text => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.replace('{p}', String(p))])) as Text;
const isPort = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535;

interface Sub { fn: (...args: OscArg[]) => void }

export default {
  name: 'yanuo.osc',
  apply(ctx: MainContext) {
    const c = ctx.config;
    const port = c['mode'] === 'fixed' ? (isPort(c['port']) ? c['port'] : RECEIVE_PORT) : null;   // null = OSCQuery
    const sendPort = isPort(c['sendPort']) ? c['sendPort'] : SEND_PORT;
    const forwardPorts = c['forward'] === true && Array.isArray(c['forwardPorts']) ? [...new Set(c['forwardPorts'].filter(isPort))] : [];

    const out = dgram.createSocket('udp4');
    out.on('error', e => ctx.log(`send socket: ${errorText(e)}`, 'error'));
    const subs = new Map<string, Set<Sub>>();   // 地址 → 订阅
    const sent: number[] = [];   // 发出消息的时间
    let link: OscLink | null = null;
    let busy: Promise<void> = Promise.resolve();
    let retryAt = 0;       // 接收没开起来时下次重试的时间(ms)，0 = 不用重试
    let lastError = '';    // 最近一次开接收失败的错误文字，同一个错误只记一次日志
    let closed = false;    // 组件已卸载

    // 一条消息交给订了这个地址的组件；一个订阅出错不影响别的
    const dispatch = (m: OscMessage): void => {
      for (const s of subs.get(m.address) ?? []) {
        try {
          s.fn(...m.args);
        } catch (e) {
          ctx.log(`listener of ${m.address}: ${errorText(e)}`, 'error');
        }
      }
    };

    // 开接收；开不起来时定下重试时间
    const open = async (): Promise<void> => {
      const l = new OscLink({
        wants: address => subs.has(address),
        onMessage: dispatch,
        onRaw: buf => {
          for (const p of forwardPorts) out.send(buf, p, LOCAL);
        },
        onError: e => ctx.log(`receiver: ${errorText(e)}`, 'error'),
      });
      link = l;
      try {
        await l.start(port);
        lastError = '';
        ctx.log(`receiver on ${port === null ? 'oscquery' : 'fixed port'} ${l.udpPort ?? ''}`);
      } catch (e) {
        link = null;
        retryAt = Date.now() + RETRY_MS;
        const text = errorText(e);
        if (text !== lastError) ctx.log(`cannot start receiver: ${text}`, 'error');
        lastError = text;
      }
    };

    // 有订阅或要转发时开接收，都没有时关掉；排队执行，同一时刻只有一次开关在进行
    const sync = (): void => {
      busy = busy.then(async () => {
        const want = !closed && (subs.size > 0 || forwardPorts.length > 0);
        retryAt = 0;
        if (link && !want) {
          const l = link;
          link = null;
          await l.stop();
          ctx.log('receiver stopped');
        }
        if (!want || link) return;
        await open();
        if (!closed) report();
      }).catch((e: unknown) => ctx.log(`receiver: ${errorText(e)}`, 'error'));
    };

    const osc: OscService = {
      on(address, fn) {
        const key = String(address);
        const sub: Sub = { fn };
        const set = subs.get(key) ?? new Set<Sub>();
        subs.set(key, set.add(sub));
        sync();
        return () => {
          set.delete(sub);
          if (set.size === 0 && subs.get(key) === set) subs.delete(key);
          sync();
        };
      },
      send(address, args) {
        out.send(encodeMessage(address, args), sendPort, LOCAL);
        sent.push(Date.now());
      },
    };

    // 状态栏：灯和状态文字、接收端口、发送端口、最近一小时发出的消息数
    const report = (): void => {
      const now = Date.now();
      while (sent.length && sent[0]! < now - HOUR_MS) sent.shift();
      const rate = `↑ ${sent.length}/H`;
      const live = link !== null && now - link.lastAt < LIVE_MS;
      const led: StatusItem['led'] = !link ? 'idle' : live ? 'ok' : 'wait';
      const recv: Text = !link || link.udpPort === null ? '—' : port === null ? `OSCQuery ${link.udpPort}` : fill(T.fixed, link.udpPort);
      ctx.status.set({
        led, label: 'OSC', value: rate,
        state: !link ? T.idle : live ? T.receiving : T.waiting,
        rows: [
          { label: T.recv, value: recv },
          { label: T.send, value: `${LOCAL}:${sendPort}` },
          { label: T.msgs, value: rate },
        ],
      });
    };

    ctx.provide('osc', osc);
    sync();
    report();
    const timer = setInterval(() => {
      if (retryAt && Date.now() >= retryAt) sync();
      report();
    }, STATUS_MS);
    // 卸载时发送套接字留到接收关掉以后关：转发也用它
    ctx.effect(() => () => {
      clearInterval(timer);
      closed = true;
      sync();
      void busy.then(() => out.close());
    });
  },
};
