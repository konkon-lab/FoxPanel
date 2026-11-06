// 听写音频的格式：单声道 16 位 PCM。媒体页采集、主进程计时、识别请求都按这里的值(不依赖 node，页面代码也能导入)。

export const ASR_SAMPLE_RATE = 16000;   // 采样率(Hz)
export const ASR_FRAME_MS = 100;        // 媒体页每帧的时长(毫秒)
export const ASR_BYTES_PER_SEC = ASR_SAMPLE_RATE * 2;   // 每秒音频的字节数(每个采样 2 字节)
