// 语音合成组件的主进程部分和媒体页部分之间的总线频道
export const PLAY = 'yanuo.tts-bailian/play';   // 主进程 → 媒体页：一句合成好的 mp3(Uint8Array)
