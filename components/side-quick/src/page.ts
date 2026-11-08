// 快捷设置页：三个开关、发送到、清除聊天气泡。

import { slotPlugin } from '../../_shared/vue.ts';
import Quick from './Quick.vue';

export default slotPlugin('yanuo.side-quick', Quick, ['kb', 'i18n']);
