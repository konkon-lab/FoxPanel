// 面板页面和媒体页面的 preload：只把 PageApi 挂到 window.fox 上，组件管理、应用设置、窗口控制等接口这两种页面拿不到。

import { contextBridge, ipcRenderer } from 'electron';
import { PAGE_IPC, type MediaPlan, type PageApi, type PageLook, type PanelPlan } from '../shared/types.ts';
import { visibleState } from './visible.ts';

// 这块面板是不是正被显示：宿主每次变了都发来
const visible = visibleState();
ipcRenderer.on(PAGE_IPC.visibleEvent, (_e, on: unknown) => visible.receive(on));

const fox: PageApi = {
  plan: () => ipcRenderer.invoke(PAGE_IPC.plan) as Promise<PanelPlan | MediaPlan>,
  look: () => ipcRenderer.invoke(PAGE_IPC.look) as Promise<PageLook>,
  onLook: fn => { ipcRenderer.on(PAGE_IPC.lookEvent, (_e, look: PageLook) => fn(look)); },
  setDark: on => ipcRenderer.send(PAGE_IPC.setDark, on),
  onVisible: fn => visible.watch(fn),
  hide: () => ipcRenderer.send(PAGE_IPC.hide),
  storageCall: (id, call) => ipcRenderer.invoke(PAGE_IPC.storageCall, id, call) as Promise<unknown>,
  busSend: (channel, data) => ipcRenderer.send(PAGE_IPC.busSend, channel, data),
  busListen: (channel, on) => ipcRenderer.send(PAGE_IPC.busListen, channel, on),
  onBus: fn => { ipcRenderer.on(PAGE_IPC.busEvent, (_e, channel: string, data: unknown) => fn(channel, data)); },
  logWrite: (source, text, level) => ipcRenderer.send(PAGE_IPC.logWrite, source, text, level),
  relayUse: (name, on) => ipcRenderer.invoke(PAGE_IPC.relayUse, name, on) as Promise<void>,
  onRelay: fn => { ipcRenderer.on(PAGE_IPC.relayEvent, (_e, name: string, state: unknown) => fn(name, state)); },
  relayCall: (name, method, args, wait) => ipcRenderer.invoke(PAGE_IPC.relayCall, name, method, args, wait) as Promise<unknown>,
};

contextBridge.exposeInMainWorld('fox', fox);
