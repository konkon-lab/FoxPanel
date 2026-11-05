// Naive UI 主题(浅色)：浅灰画布、白色卡片、蓝紫强调色、统一 6px 圆角。颜色和 style.css 的变量一致。

import type { GlobalThemeOverrides } from 'naive-ui';

export const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#4f5bd5',
    primaryColorHover: '#4350c4',
    primaryColorPressed: '#3a45ad',
    primaryColorSuppl: '#4350c4',
    successColor: '#1f7a47',
    warningColor: '#9a5b00',
    errorColor: '#b42318',
    textColorBase: '#1c1d21',
    textColor1: '#1c1d21',
    textColor2: '#1c1d21',
    textColor3: '#62666d',
    bodyColor: '#f7f8fa',
    cardColor: '#ffffff',
    popoverColor: '#ffffff',
    borderColor: '#8d9199',
    dividerColor: 'rgba(17, 24, 39, 0.08)',
    borderRadius: '6px',
    borderRadiusSmall: '6px',
    fontSize: '14px',
    fontSizeMedium: '14px',
    heightMedium: '36px',
    fontWeightStrong: '600',
    fontFamily: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif',
  },
  Button: {
    fontWeight: '500',
  },
  // 方形开关：底槽 6px 圆角，按钮 4px 圆角
  Switch: {
    railHeightMedium: '24px',
    railWidthMedium: '44px',
    railBorderRadiusMedium: '6px',
    buttonHeightMedium: '20px',
    buttonWidthMedium: '20px',
    buttonBorderRadiusMedium: '4px',
    railColor: '#e3e5ea',
  },
};

// 夜间：盖在 Naive UI 深色主题上的颜色，与 style.css 一致
export const darkOverrides: GlobalThemeOverrides = {
  common: {
    ...themeOverrides.common,
    primaryColor: '#7c87f0',
    primaryColorHover: '#939cf4',
    primaryColorPressed: '#6670e0',
    primaryColorSuppl: '#939cf4',
    successColor: '#6cc191',
    warningColor: '#e0b052',
    errorColor: '#f07a70',
    textColorBase: '#e4e5e8',
    textColor1: '#e4e5e8',
    textColor2: '#e4e5e8',
    textColor3: '#9da1a8',
    bodyColor: '#121316',
    cardColor: '#1d1f24',
    modalColor: '#1d1f24',
    popoverColor: '#24262c',
    inputColor: '#24262c',
    borderColor: '#3a3d45',
    dividerColor: 'rgba(255, 255, 255, 0.08)',
  },
  Button: { fontWeight: '500' },
  Switch: { ...themeOverrides.Switch, railColor: '#3a3d45' },
  Input: { border: '1px solid #3a3d45', color: '#24262c' },
  InternalSelection: { border: '1px solid #3a3d45', color: '#24262c' },
};
