<div align="center">
  <img width="200" src="../resources/icon.svg" alt="FoxPanel">

**FoxPanel - 一个基于 Cordis の组件化框架**

[![Codecov](https://codecov.io/gh/konkon-lab/FoxPanel/graph/badge.svg)](https://app.codecov.io/gh/konkon-lab/FoxPanel)
[![License](https://img.shields.io/badge/license-MIT-blue)](../LICENSE)
[![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078d4)](../docs/guide.md#安装)
[![SteamVR](https://img.shields.io/badge/SteamVR-overlay-1b2838)](../docs/steamvr.md)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524-5fa04e)](CONTRIBUTING.md#开发环境)

<p>
  <a href="https://github.com/konkon-lab/FoxPanel/releases"><img alt="下载最新版本" src="https://img.shields.io/badge/%E4%B8%8B%E8%BD%BD%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC-f97316?style=for-the-badge&logo=github&logoColor=white"></a>
  <a href="https://github.com/konkon-lab/FoxPanel/issues"><img alt="报告 Bug" src="https://img.shields.io/badge/%E6%8A%A5%E5%91%8A_Bug-e5484d?style=for-the-badge&logo=github&logoColor=white"></a>
  <a href="CONTRIBUTING.md#开发环境"><img alt="从源码运行" src="https://img.shields.io/badge/%E4%BB%8E%E6%BA%90%E7%A0%81%E8%BF%90%E8%A1%8C-5fa04e?style=for-the-badge&logo=nodedotjs&logoColor=white"></a>
  <a href="https://qm.qq.com/q/eKpfbBwD0k"><img alt="加入交流群" src="https://img.shields.io/badge/%E5%8A%A0%E5%85%A5%E4%BA%A4%E6%B5%81%E7%BE%A4-12b7f5?style=for-the-badge&logo=qq&logoColor=white"></a>
</p>

</div>

---

## FoxPanel 是什么？

FoxPanel 是一个基于 Cordis 开发的组件化框架。它的目标不仅仅是做一块 VR 输入法，而是为你构筑一个可以自由扩展的开发基座。我们希望它成为连接 VR 与外部世界的桥梁，让你的创造力有处安放。

无论你想在 VR 里放一块随手可用的悬浮键盘、让 VRChat 的 OSC 参数驱动联动设备，还是创建一块悬浮屏幕，FoxPanel 都能成为稳固的起点。

---

## 特性

- **组件化架构**：键盘、主窗口各页、SteamVR 显示方都是独立组件，可随时启用、替换或卸载
- **开箱即用的 VR 键盘**：拼音(简繁)、英文、日文、韩文，直接发到 VRChat 聊天框；接入阿里云百炼后可用语音合成、语音输入和翻译
- **开发友好**：一个文件夹加一份 `component.json` 即是一个组件，修改后自动重载；无需头显即可调试，SDK 提供完整的 TypeScript 类型

---

## 快速起步

1. 从 [Releases](https://github.com/konkon-lab/FoxPanel/releases) 下载安装包并运行，需要 64 位的 Windows 10 或 11 和 SteamVR
2. 打开 FoxPanel 和 SteamVR，右手 B 键双击叫出面板
3. 在 VRChat 里打开 OSC，就能把文字发到聊天框

想从源码运行或参与开发，见 [贡献指南](CONTRIBUTING.md)。

---

## 交流

有问题、想法或者做了组件想分享，欢迎来 QQ 群：[诺狐の研究所](https://qm.qq.com/q/eKpfbBwD0k)

---

## 开源协议

FoxPanel 自己的代码以 MIT 许可证发布，全文见 [LICENSE](../LICENSE)。

`vendor/` 下和随安装包分发的第三方文件各按各的许可证，见 [OPEN_SOURCE_LICENSES.md](../OPEN_SOURCE_LICENSES.md)。安装包里的输入法引擎 `rime.dll` 带着 GPL-3.0 的 librime-octagram，再分发整个安装包时还要满足 GPL-3.0 的条件。
