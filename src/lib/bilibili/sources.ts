/**
 * B 站 UP 主池配置（D-1）
 *
 * 来源：
 *   - docs/06-B站与多模态-增量设计.md §3.3（默认 2 个）
 *   - docs/27-B站UP主调研-infinite灵感港.md（追加 1 个）
 *   - 26-Phase2差异化功能实施计划.md §3（AI 垂直领域 UP 主）
 *
 * 维护：
 *   - 编辑此文件即可调整 UP 主池；新加 UP 主只需填好 uid/name/priority
 *   - priority 是抓取优先级（数值大 = 优先），影响新闻并入 NewsItem 时的去重策略
 *   - tag 决定视频分类标签，便于 UI 分区展示
 *
 * 注意：
 *   - UID 是 B 站数字 ID，不是 BV 号
 *   - 5 个 UP 主 × 5 条视频 = 25 个视频/抓取周期，Vercel 函数 300s 内足够完成
 */

export interface BilibiliUploaderConfig {
  /** UP 主名 */
  name: string;
  /** UP 主 UID（数字）*/
  uid: string;
  /** 优先级（10 最高），用于视频列表排序和健康度告警分级 */
  priority: number;
  /** 标签（UI 分区、内容类型描述）*/
  tag: string;
  /** 备注（可选）*/
  notes?: string;
  /** 是否启用（默认 true）*/
  enabled?: boolean;
}

/**
 * UP 主池
 *
 * 选择标准：
 *   - AI 浓度高（视频主题聚焦 AI）
 *   - 更新频繁（每周 ≥ 3 条）
 *   - 字幕完整（自动字幕可用）
 *   - 内容简短（1-15 分钟，抓取成本低）
 */
export const UPLOADERS: BilibiliUploaderConfig[] = [
  {
    name: '黑鸦Heya',
    uid: '3706929260006322',
    priority: 10,
    tag: 'AI日报 / 深度科技',
    notes: 'D-1 起步，深度科技日报，5-15 分钟',
  },
  {
    name: '橘鸦Juya',
    uid: '285286947',
    priority: 10,
    tag: '每日 AI 早报',
    notes: 'D-1 起步，每日 1-2 分钟简报，503+ 期',
  },
  {
    name: 'infinite灵感港',
    uid: '3493082576193678',
    priority: 9,
    tag: 'AI日报简报',
    notes: '2026-08-30 调研加入：每日 1-2 分钟短报，覆盖国内外 AI 厂商',
  },
  {
    name: '我是小杰JayC',
    uid: '14174446',
    priority: 9,
    tag: 'AI 技术分析',
    notes: '5-10 分钟 AI 技术深度分析',
  },
  {
    name: 'AI悦创',
    uid: '387636265',
    priority: 8,
    tag: '编程教程',
    notes: '10-30 分钟 AI 编程教程',
  },
  {
    name: '大谷Spitzer',
    uid: '358926640',
    priority: 8,
    tag: 'AI 评论',
    notes: '5-15 分钟 AI 行业评论',
  },
  {
    name: 'OpenBMB',
    uid: '507067288',
    priority: 7,
    tag: '学术研究',
    notes: '10-20 分钟大模型学术研究分享',
  },
];

/** 过滤后启用的 UP 主 */
export const ENABLED_UPLOADERS = UPLOADERS.filter((u) => u.enabled !== false);

/** 根据 UID 查找 UP 主 */
export function getUploaderByUid(uid: string): BilibiliUploaderConfig | undefined {
  return ENABLED_UPLOADERS.find((u) => u.uid === uid);
}
