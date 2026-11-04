// 主窗口的 preload：把主进程的 IPC 封装成 window.fox(FoxApi)。

import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type CodeComponent, type ComponentList, type ComponentPreview, type ComponentResult, type DirListing, type FoxApi, type InitPayload, type LogEntry, type SecretReveal, type Settings, type SysStats, type UpdateState } from '../shared/types.ts';

const fox: FoxApi = {
  init: () => ipcRenderer.invoke(IPC.init) as Promise<InitPayload>,
  setLanguage: lang => ipcRenderer.invoke(IPC.language, lang) as Promise<void>,
  onSettings: fn => { ipcRenderer.on(IPC.settingsEvent, (_e, s: Settings) => fn(s)); },
  compList: () => ipcRenderer.invoke(IPC.compList) as Promise<ComponentList>,
  onCompList: fn => { ipcRenderer.on(IPC.compListEvent, (_e, list: ComponentList) => fn(list)); },
  compPick: () => ipcRenderer.invoke(IPC.compPick) as Promise<ComponentPreview>,
  compInstall: confirm => ipcRenderer.invoke(IPC.compInstall, confirm) as Promise<ComponentResult>,
  compRemove: id => ipcRenderer.invoke(IPC.compRemove, id) as Promise<ComponentResult>,
  compRemoveBroken: folder => ipcRenderer.invoke(IPC.compRemoveBroken, folder) as Promise<ComponentResult>,
  compSet: patch => ipcRenderer.invoke(IPC.compSet, patch) as Promise<ComponentResult>,
  compSecret: (id, key, value) => ipcRenderer.invoke(IPC.compSecret, id, key, value) as Promise<ComponentResult>,
  compDevAdd: () => ipcRenderer.invoke(IPC.compDevAdd) as Promise<ComponentResult>,
  compOpenFolder: folder => ipcRenderer.invoke(IPC.compOpenFolder, folder) as Promise<void>,
  compHostRestart: () => ipcRenderer.invoke(IPC.compHostRestart) as Promise<void>,
  storageCall: (id, call) => ipcRenderer.invoke(IPC.storageCall, id, call) as Promise<unknown>,
  busSend: (channel, data) => ipcRenderer.send(IPC.busSend, channel, data),
  updateState: () => ipcRenderer.invoke(IPC.updateState) as Promise<UpdateState>,
  onUpdate: fn => { ipcRenderer.on(IPC.updateEvent, (_e, s: UpdateState) => fn(s)); },
  updateCheck: () => ipcRenderer.invoke(IPC.updateCheck) as Promise<void>,
  updateInstall: () => ipcRenderer.invoke(IPC.updateInstall) as Promise<void>,
  onBus: fn => { ipcRenderer.on(IPC.busEvent, (_e, channel: string, data: unknown) => fn(channel, data)); },
  windowPlan: () => ipcRenderer.invoke(IPC.windowPlan) as Promise<CodeComponent[]>,
  onWindowPlan: fn => { ipcRenderer.on(IPC.windowPlanEvent, (_e, plan: CodeComponent[]) => fn(plan)); },
  logList: () => ipcRenderer.invoke(IPC.logList) as Promise<LogEntry[]>,
  onLog: fn => { ipcRenderer.on(IPC.logEvent, (_e, lines: LogEntry[]) => fn(lines)); },
  logWrite: (source, text, level) => ipcRenderer.send(IPC.logWrite, source, text, level),
  dirList: rel => ipcRenderer.invoke(IPC.dirList, rel) as Promise<DirListing>,
  dirMake: (rel, name) => ipcRenderer.invoke(IPC.dirMake, rel, name) as Promise<ComponentResult>,
  compSecretReveal: (id, key) => ipcRenderer.invoke(IPC.compSecretReveal, id, key) as Promise<SecretReveal>,
  compNpm: op => ipcRenderer.invoke(IPC.compNpm, op) as Promise<ComponentResult>,
  marketSearch: refresh => ipcRenderer.invoke(IPC.marketSearch, refresh) as ReturnType<FoxApi['marketSearch']>,
  marketInfo: (name, version) => ipcRenderer.invoke(IPC.marketInfo, name, version) as ReturnType<FoxApi['marketInfo']>,
  openExternal: url => ipcRenderer.invoke(IPC.openExternal, url) as Promise<void>,
  winMinimize: () => ipcRenderer.send(IPC.winMinimize),
  winMaximize: () => ipcRenderer.send(IPC.winMaximize),
  winClose: () => ipcRenderer.send(IPC.winClose),
  onCloseAsk: fn => {
    ipcRenderer.on(IPC.closeAsk, () => fn());
    ipcRenderer.send(IPC.closeHandler);
  },
  closeAnswer: action => ipcRenderer.send(IPC.closeAnswer, action),
  setApp: patch => ipcRenderer.invoke(IPC.setApp, patch) as Promise<void>,
  openDataDir: (rel?: string) => ipcRenderer.invoke(IPC.openDataDir, rel ?? '') as Promise<void>,
  onStats: fn => { ipcRenderer.on(IPC.statsEvent, (_e, s: SysStats) => fn(s)); },
};

contextBridge.exposeInMainWorld('fox', fox);
