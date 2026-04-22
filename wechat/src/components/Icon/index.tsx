/**
 * Icon 组件 — Lucide 风格 SVG 图标
 * 替代 emoji，提供统一、专业的图标系统
 *
 * 用法：
 *   <Icon name="search" size={24} color="#6366f1" />
 *   <Icon name="play" size={32} />
 */
import { useMemo } from 'react';
import { View, Text } from '@tarojs/components';

// SVG path 数据（Lucide 风格，24x24 viewBox）
const PATHS: Record<string, string> = {
  // 导航
  search: 'M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  chevronRight: 'M9 18l6-6-6-6',
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 18l-6-6 6-6',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',

  // 操作
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  x: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  plus: 'M12 5v14M5 12h14',
  edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',

  // 音频/语音
  microphone: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8',
  play: 'M5 3l14 9-14 9V3z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  volume: 'M11 5L6 9H2v6h4l5 4V5z M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07',

  // 日历/时间/位置
  calendar: 'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
  mapPin: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',

  // 用户/认证
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  shieldCheck: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4',
  verified: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4',

  // 评分/反馈
  star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  heart: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z',
  messageCircle: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',

  // 文件/文档
  fileText: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6M16 13H8M16 17H8M10 9H8',

  // 品牌特殊
  sparkles: 'M12 3l1.912 5.813L20 10l-6.088 1.187L12 17l-1.912-5.813L4 10l6.088-1.187L12 3z M19 15l.94 2.81L23 18.5l-3.06.69L19 22l-.94-2.81L15 18.5l3.06-.69L19 15z',
  zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  rocket: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3M16 3l-4 4-4-4M8 7l-4 4 4 4 4-4-4-4z',

  // 警告/提示
  alertCircle: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v4M12 16h.01',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01',

  // 视频会议
  video: 'M23 7l-7 5 7 5V7zM1 5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H1a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  monitor: 'M8 21h8M12 17v4M6 3h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',

  // 链接/外跳
  externalLink: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
};

// 图标名类型
export type IconName = keyof typeof PATHS;

interface IconProps {
  /** 图标名称 */
  name: IconName;
  /** 尺寸（px），默认 24 */
  size?: number;
  /** 颜色，默认当前文字色 */
  color?: string;
  /** 自定义类名 */
  className?: string;
}

/**
 * 基于 SVG 的图标组件
 *
 * 在微信小程序中，由于不支持内联 SVG，
 * 使用 <Image> + data URI 方式渲染。
 * 对于简单场景，也可以用 Text 组件 + Unicode 符号。
 */
export default function Icon({ name, size = 24, color = 'currentColor', className }: IconProps) {
  const pathData = PATHS[name];

  // 如果找不到图标，显示一个占位
  if (!pathData) {
    return (
      <View
        className={className}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '2px',
          background: '#f1f5f9',
        }}
      >
        <Text style={{ fontSize: `${Math.round(size * 0.5)}px`, color: '#94a3b8' }}>?</Text>
      </View>
    );
  }

  // 使用 SVG data URI 方式
  const svgUri = useMemo(() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${pathData}"/></svg>`;
    // 微信小程序 Image 组件支持 data URI
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }, [name, size, color, pathData]);

  return (
    <View
      className={className}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        display: 'inline-flex',
        flexShrink: 0,
      }}
    >
      {/* eslint-disable-next-line @tarojs/no-html -- SVG data URI 是小程序安全的 */}
      <image
        src={svgUri}
        mode="aspectFit"
        style={{ width: `${size}px`, height: `${size}px` }}
      />
    </View>
  );
}

/**
 * 导出所有可用的图标名称，供其他组件引用
 */
export const ICON_NAMES = Object.keys(PATHS) as IconName[];
