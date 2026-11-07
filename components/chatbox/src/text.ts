// VRChat 聊天框里显示的文字。

const CHATBOX_MAX = 144;   // VRChat 聊天框单条消息的字数上限

// 有译文时为「原文（译文）」，未翻译(译文与原文相同)时仅显示原文；超出上限的部分截断
export function chatboxText(original: string, spoken: string): string {
  const text = spoken === original ? original : `${original}（${spoken}）`;
  return [...text].slice(0, CHATBOX_MAX).join('');
}
