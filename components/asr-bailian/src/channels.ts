// 听写组件的主进程部分和媒体页部分之间的总线频道
export const MIC = 'yanuo.asr-bailian/mic';           // 主进程 → 媒体页：开(true)/ 关麦克风
export const PCM = 'yanuo.asr-bailian/pcm';           // 媒体页 → 主进程：一帧 PCM(格式见 _bailian/pcm.ts)
export const MIC_ERROR = 'yanuo.asr-bailian/error';   // 媒体页 → 主进程：麦克风打不开，数据是原因
