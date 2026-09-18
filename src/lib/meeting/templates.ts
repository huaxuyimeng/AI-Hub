/**
 * 会议模板预设（v1 — 2026-09-17）
 *
 * 每个模板包含：
 *   - name：模板显示名
 *   - icon：Tabler icon 名
 *   - description：1 句话描述适用场景
 *   - topic：会议主题（用户可编辑）
 *   - suggestedExperts：建议的专家 slug 数组（2~5 个）
 *   - accentColor：卡片颜色
 *
 * 设计原则：
 *   - 模板仅提供起点，用户确认前可自由编辑
 *   - 每个模板覆盖一个真实工作场景
 *
 * 过期条件：
 *   - 专家 slug 失效（如 'engineer' 被删除）→ 该模板的专家推荐消失，但模板仍可手动选人
 *   - 触发：新增 / 改 slug → 同步更新 suggestedExperts
 */

export interface MeetingTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** 主题占位符（用户可替换） */
  topic: string;
  /** 建议的专家 slug（对应 ExpertAgent.slug） */
  suggestedExperts: string[];
  accentColor: string;
}

export const MEETING_TEMPLATES: MeetingTemplate[] = [
  {
    id: 'product-review',
    name: '产品评审会',
    icon: 'IconTarget',
    description: '评估一个新功能或产品方向是否值得做',
    topic: '是否要做一个面向[目标用户]的[产品方向]？',
    suggestedExperts: ['product-manager', 'investor', 'critic'],
    accentColor: '#6366F1',
  },
  {
    id: 'architecture-design',
    name: '架构设计评审',
    icon: 'IconTopologyStar3',
    description: '评估技术方案的可行性、风险与替代方案',
    topic: '[项目名]的[模块]技术选型：方案 A vs 方案 B？',
    suggestedExperts: ['engineer', 'security-expert', 'data-analyst'],
    accentColor: '#10B981',
  },
  {
    id: 'investment-analysis',
    name: '投资分析会',
    icon: 'IconCoin',
    description: '评估一个创业项目 / 商业方向的 VC 可投性',
    topic: '[公司/项目名]的 VC 可投性分析',
    suggestedExperts: ['investor', 'industry-researcher', 'critic', 'finance-expert'],
    accentColor: '#F59E0B',
  },
  {
    id: 'code-review',
    name: '代码评审会',
    icon: 'IconGitPullRequest',
    description: '对一段代码 / PR / 架构做全方位质量评估',
    topic: '[代码片段/PR/模块名]的代码质量评审',
    suggestedExperts: ['engineer', 'security-expert', 'data-analyst'],
    accentColor: '#EF4444',
  },
  {
    id: 'security-audit',
    name: '安全审计会',
    icon: 'IconShieldLock',
    description: '识别系统或代码的潜在安全风险与加固建议',
    topic: '[系统名]的安全威胁建模与加固方案',
    suggestedExperts: ['security-expert', 'engineer', 'legal-counsel'],
    accentColor: '#DC2626',
  },
  {
    id: 'market-strategy',
    name: '市场策略会',
    icon: 'IconChartBar',
    description: '制定一个产品的营销策略与用户增长路径',
    topic: '[产品名]的市场推广与用户增长策略',
    suggestedExperts: ['marketer', 'operations-expert', 'investor', 'pr-expert'],
    accentColor: '#EC4899',
  },
  {
    id: 'team-building',
    name: '团队建设会',
    icon: 'IconUsers',
    description: '诊断团队问题、设计招聘策略或绩效体系',
    topic: '[团队名]的[问题诊断/招聘策略/绩效体系]设计',
    suggestedExperts: ['hr-expert', 'operations-expert', 'critic'],
    accentColor: '#14B8A6',
  },
  {
    id: 'legal-review',
    name: '合同/合规审查',
    icon: 'IconScale',
    description: '审查合同条款、评估合规风险、提供修改建议',
    topic: '[合同类型]条款审查与合规风险评估',
    suggestedExperts: ['legal-counsel', 'ip-lawyer', 'startup-lawyer'],
    accentColor: '#8B5CF6',
  },
];
