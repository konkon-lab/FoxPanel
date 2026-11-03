// 组件的 secret 设置：用系统凭据(safeStorage，Windows 上是 DPAPI)加密成 base64，存 userData/secrets.json，
// 键为「组件id/设置key」。主窗口只拿到遮住中间的预览(前 4 位和后 2 位，只在内存里)，明文只在主进程解密后交给主进程组件。

import fs from 'node:fs';
import { isObject } from '../../shared/util.ts';

export interface Cipher {
  encrypt(text: string): Promise<string>;   // → base64
  decrypt(stored: string): Promise<string>;
}

// 遮住中间：前 4 位和后 2 位，太短的全遮
export function maskSecret(v: string): string {
  return v.length > 6 ? `${v.slice(0, 4)}••••••${v.slice(-2)}` : '••••••';
}

// secrets.json 里的键
const keyOf = (id: string, key: string): string => `${id}/${key}`;

export class SecretStore {
  private readonly file: string;
  private readonly cipher: Cipher;
  private data: Record<string, string>;                 // keyOf → 加密后的 base64
  private readonly hints = new Map<string, string>();   // 预览，只在内存

  constructor(file: string, cipher: Cipher) {
    this.file = file;
    this.cipher = cipher;
    this.data = {};
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (isObject(raw)) {
        for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') this.data[k] = v;
      }
    } catch { /* 还没有 */ }
  }

  // 启动时解密一遍，算出各 secret 的预览
  async warm(): Promise<void> {
    for (const k of Object.keys(this.data)) {
      const v = await this.decrypt(k);
      if (v) this.hints.set(k, maskSecret(v));
    }
  }

  // 预览；没设或还没解密时为空字符串
  hint(id: string, key: string): string {
    return this.hints.get(keyOf(id, key)) ?? '';
  }

  has(id: string, key: string): boolean {
    return keyOf(id, key) in this.data;
  }

  // 空字符串 = 清除
  async set(id: string, key: string, value: string): Promise<void> {
    const k = keyOf(id, key);
    if (value) {
      this.data[k] = await this.cipher.encrypt(value);
      this.hints.set(k, maskSecret(value));
    } else {
      delete this.data[k];
      this.hints.delete(k);
    }
    this.save();
  }

  // 解密；没有或解密失败(换了系统用户、文件复制到别的电脑)返回空字符串
  get(id: string, key: string): Promise<string> {
    return this.decrypt(keyOf(id, key));
  }

  // 按 secrets.json 里的键解密
  private async decrypt(k: string): Promise<string> {
    const stored = this.data[k];
    if (!stored) return '';
    try {
      return await this.cipher.decrypt(stored);
    } catch {
      return '';
    }
  }

  // 卸载组件时删掉它的全部 secret
  removeAll(id: string): void {
    const before = Object.keys(this.data).length;
    for (const k of Object.keys(this.data)) {
      if (!k.startsWith(keyOf(id, ''))) continue;
      delete this.data[k];
      this.hints.delete(k);
    }
    if (Object.keys(this.data).length !== before) this.save();
  }

  private save(): void {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}
