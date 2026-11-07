// 经典外壳：键盘面板的根组件。上面候选栏、输入框，下面键区 + 侧栏页 + 侧栏(页签、侧栏按钮)；
// 候选栏、输入框、键区的插槽里没有部件时显示缺件提示。

import { slotPlugin } from '../../_shared/vue.ts';
import Shell from './Shell.vue';

export default slotPlugin('yanuo.shell-classic', Shell, ['i18n']);
