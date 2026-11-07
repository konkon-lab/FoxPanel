// 本组件主窗口部分的文案(语言组件详情里的输入模式和搜狗词库)。
import { defineMessages } from '@konkon-lab/foxpanel-window';

export default defineMessages({
  'ime.config': '基础设置',
  'ime.mode': '模式',
  'ime.sogou': '搜狗词库',
  'ime.sogouDesc': '把搜狗输入法的用户词库导入拼音。',
  'ime.sogouImport': '导入',
  'ime.sogouDone': '已导入 {n} 条',
}, {
  'zh-Hant': {
    'ime.config': '基本設定',
    'ime.mode': '模式',
    'ime.sogou': '搜狗詞庫',
    'ime.sogouDesc': '把搜狗輸入法的使用者詞庫匯入拼音。',
    'ime.sogouImport': '匯入',
    'ime.sogouDone': '已匯入 {n} 筆',
  },
  ja: {
    'ime.config': '基本設定',
    'ime.mode': 'モード',
    'ime.sogou': 'Sogou 辞書',
    'ime.sogouDesc': 'Sogou IME のユーザー辞書をピンインに取り込みます。',
    'ime.sogouImport': '取り込む',
    'ime.sogouDone': '{n} 件取り込み済み',
  },
  en: {
    'ime.config': 'Settings',
    'ime.mode': 'Mode',
    'ime.sogou': 'Sogou dictionary',
    'ime.sogouDesc': 'Import your Sogou IME user dictionary into Pinyin.',
    'ime.sogouImport': 'Import',
    'ime.sogouDone': '{n} words imported',
  },
  ko: {
    'ime.config': '기본 설정',
    'ime.mode': '모드',
    'ime.sogou': 'Sogou 사전',
    'ime.sogouDesc': 'Sogou 입력기의 사용자 사전을 병음으로 가져옵니다.',
    'ime.sogouImport': '가져오기',
    'ime.sogouDone': '{n}개 가져옴',
  },
});
