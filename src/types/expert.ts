/**
 * 专家（Expert）共享类型定义
 *
 * 来源：腾讯元宝 / 元器 WorkBuddy 专家市场调研
 * 用于：tRPC 客户端 hook、前端组件 props、表单 state
 */

export interface ExpertListItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Tabler icon 名（如 'IconTarget'）；客户端动态 import 渲染 */
  icon: string;
  /** 分类标签（中文，如"产品经理"） */
  category: string;
  /** 适用场景，逗号分隔字符串（前端 split 处理） */
  scenarios: string;
  /** 标签，逗号分隔字符串 */
  tags: string;
  /** 卡片顶边装饰色，HEX 格式（如 "#6366F1"） */
  accentColor: string;
  /** 头像 URL（可选） */
  avatarUrl: string | null;
  /** 推荐模型（externalId） */
  recommendedModel: string | null;
  /** 使用次数 */
  useCount: number;
  /** 排序权重（数字越小越靠前） */
  sortOrder: number;
  /** 是否系统预置 */
  isBuiltIn: boolean;
  /** 创建时间 */
  createdAt: Date;
  /** MVP2：平均评分（1-5，0 = 无评分）*/
  avgRating: number;
  /** MVP2：评分人数 */
  ratingCount: number;
  /** MVP2：（可选）完整提示词，仅 getWithPrompt 返回时填充 */
  systemPrompt?: string;
}

/** MVP2：用户评分提交 */
export interface ExpertRatingSubmission {
  agentId: string;
  rating: number; // 1-5
  comment?: string; // ≤500 字
}

/** MVP2：评分评论（公开展示） */
export interface ExpertComment {
  id: string;
  rating: number;
  comment: string;
  createdAt: Date;
  /** 用户 hash（前 4 字符 + ***） */
  userHash: string;
}

export interface ExpertWithPrompt extends ExpertListItem {
  /** 系统提示词（仅 createMeeting 内部使用） */
  systemPrompt: string;
}

export interface ExpertCategory {
  category: string;
  count: number;
}

export interface ExpertListResult {
  experts: ExpertListItem[];
  total: number;
}

/** 选人面板状态 */
export interface ExpertSelection {
  /** 已选专家 ID 列表 */
  selectedIds: string[];
  /** 是否打开详情面板 */
  expandedId: string | null;
}
