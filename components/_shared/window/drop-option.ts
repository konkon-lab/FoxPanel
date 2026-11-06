// 下拉框的一个选项。

export interface DropOption {
  value: string;
  label: string;
  sub?: string;      // 名字后面的小字说明
  group?: string;    // 分组标题；相邻同组的放在一起
}
