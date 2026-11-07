// VRChat 的 OSC 接收：OSCQuery 模式——随机 UDP 端口 + mDNS 广播 + HTTP 说明，VRChat 据此发过来，不占 9001；
// 固定端口模式直接收这个端口。收到的包可以原样转发到别的本机端口。

import dgram from 'node:dgram';
import http from 'node:http';
import crypto from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { Bonjour } from 'bonjour-service';
import { BUNDLE, decodePacket, packetAddress, type OscMessage } from './codec.ts';

interface OscLinkDeps {
  wants(address: string): boolean;   // 这个地址有没有人订；没人订的消息不解码
  onMessage(m: OscMessage): void;    // 有人订的消息
  onRaw(buf: Buffer): void;          // 收到的每个原包(转发用)
  onError(e: unknown): void;         // 开始接收之后套接字或 HTTP 服务出的错
}

export class OscLink {
  udpPort: number | null = null;
  lastAt = 0;   // 最近一次收到包的时间(ms)
  private readonly name = `FoxPanel-${crypto.randomBytes(3).toString('hex')}`;   // OSCQuery 里广播的名字
  private readonly deps: OscLinkDeps;
  private udp: dgram.Socket | null = null;
  private http: http.Server | null = null;
  private bonjour: Bonjour | null = null;

  constructor(deps: OscLinkDeps) {
    this.deps = deps;
  }

  // port 为 null 时用 OSCQuery(随机端口)，否则收固定端口；开不起来时关掉已开的套接字并抛出
  async start(port: number | null): Promise<void> {
    try {
      const udp = dgram.createSocket('udp4');
      this.udp = udp;
      udp.on('message', buf => this.onPacket(buf));
      await this.listening(udp, ready => udp.bind(port ?? 0, '127.0.0.1', ready));
      this.udpPort = udp.address().port;
      if (port === null) await this.startOscQuery(this.udpPort);
    } catch (e) {
      await this.stop();
      throw e;
    }
  }

  // 等 target 开始监听：监听成功前出错则拒绝，成功后出的错交给 onError
  private listening(target: EventEmitter, listen: (ready: () => void) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      target.once('error', reject);
      listen(() => {
        target.off('error', reject);
        target.on('error', (e: unknown) => this.deps.onError(e));
        resolve();
      });
    });
  }

  private onPacket(buf: Buffer): void {
    this.lastAt = Date.now();
    this.deps.onRaw(buf);
    const address = packetAddress(buf);
    if (address === null || (address !== BUNDLE && !this.deps.wants(address))) return;
    let msgs: OscMessage[];
    try {
      msgs = decodePacket(buf);
    } catch {
      return;
    }
    for (const m of msgs) if (this.deps.wants(m.address)) this.deps.onMessage(m);
  }

  // HTTP 响应 HOST_INFO 和参数树；mDNS 中的地址为本机网卡 IP，因此 HTTP 监听所有网卡
  private async startOscQuery(udpPort: number): Promise<void> {
    const hostInfo = {
      NAME: this.name, OSC_IP: '127.0.0.1', OSC_PORT: udpPort, OSC_TRANSPORT: 'UDP',
      EXTENSIONS: { ACCESS: true, VALUE: true },
    };
    const tree = { FULL_PATH: '/', ACCESS: 0, CONTENTS: { avatar: { FULL_PATH: '/avatar', ACCESS: 2 } } };
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.url?.includes('HOST_INFO') ? hostInfo : tree));
    });
    this.http = server;
    await this.listening(server, ready => server.listen(0, '0.0.0.0', ready));
    const addr = server.address();
    const httpPort = typeof addr === 'object' && addr ? addr.port : 0;
    const bonjour = new Bonjour();
    this.bonjour = bonjour;
    bonjour.publish({ name: this.name, type: 'oscjson', protocol: 'tcp', port: httpPort });
    bonjour.publish({ name: this.name, type: 'osc', protocol: 'udp', port: udpPort });
  }

  async stop(): Promise<void> {
    const bonjour = this.bonjour;
    if (bonjour) {
      await new Promise<void>(resolve => bonjour.unpublishAll(() => resolve()));
      bonjour.destroy();
    }
    this.http?.close();
    this.udp?.close();
    this.bonjour = null;
    this.http = null;
    this.udp = null;
    this.udpPort = null;
  }
}
