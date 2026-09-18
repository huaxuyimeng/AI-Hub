/**
 * AI 代码审查 — 8 大类别定义 + 评分算法
 *
 * 评分策略（§1）：
 *   - 每类基础分 100，每发现一个 CRITICAL -25, HIGH -10, MEDIUM -5, LOW -1，最低 0
 *   - 上限保护：≥1 CRITICAL → 类分 ≤75；≥1 HIGH → ≤85；≥1 MEDIUM → ≤90
 *   - 零问题：95-100（不轻易满分，由 AI 在 prompt 中明示）
 *   - overall = Σ(categoryScore × categoryWeight)（权重和 = 1）
 *
 * 重要：AI 给的 score 只是参考，**后端必须按本算法重算**，避免 AI 评分不稳定。
 */

import { z } from 'zod';

export type CategoryKey =
  | 'security'
  | 'crud'
  | 'concurrency'
  | 'errorHandling'
  | 'boundary'
  | 'resource'
  | 'testing'
  | 'architecture';

export interface CategoryDef {
  key: CategoryKey;
  name: string;
  /** 中文副标题（解释该维度检什么） */
  description: string;
  /** 默认权重（用户可调；和必须 = 1） */
  weight: number;
  /** 该维度重点检查项（用于 AI prompt） */
  checks: string[];
}

export const DEFAULT_CATEGORIES: readonly CategoryDef[] = [
  {
    key: 'security',
    name: '安全漏洞',
    description: '注入、鉴权、敏感泄露、不安全加密',
    weight: 0.20,
    checks: [
      '硬编码 API Key / 数据库密码 / JWT Secret 等明文凭证',
      'SQL 注入：未使用参数化查询（拼接字符串）',
      'XSS：未转义用户输入直接渲染',
      '命令注入：exec/spawn 接收用户输入未过滤',
      '鉴权遗漏：API 路由未走鉴权中间件',
      '敏感数据泄露：错误信息暴露堆栈/内部结构',
      '弱加密：MD5/SHA1 哈希密码、Math.random() 用作安全场景',
    ],
  },
  {
    key: 'crud',
    name: 'CRUD 完整性',
    description: '事务、幂等、约束、状态机、删除安全',
    weight: 0.15,
    checks: [
      '事务边界：多表写入未包裹在数据库事务中',
      '幂等性缺失：POST/PUT/DELETE 无幂等键',
      '数据库约束：必填字段无 NOT NULL、唯一性未靠索引',
      '状态机跳转：状态流转未校验前置状态',
      '删除安全性：硬删/级联误删关联数据',
      'N+1 查询：循环内嵌套 findFirst',
    ],
  },
  {
    key: 'concurrency',
    name: '并发竞态',
    description: 'TOCTOU、分布式锁、异步时序、重试风暴',
    weight: 0.15,
    checks: [
      'TOCTOU 漏洞：先 findFirst 后 update 的时间窗口',
      '分布式锁：无唯一持有者 ID 或锁续期机制',
      '异步遗漏 await：导致 Promise 乱序',
      '重试风暴：无指数退避+抖动、无熔断器',
      '重试不幂等：重试产生重复副作用',
    ],
  },
  {
    key: 'errorHandling',
    name: '错误处理',
    description: '静默吞错、错误信息、外部调用容错',
    weight: 0.12,
    checks: [
      '静默吞错：catch 块为空或仅 console.log',
      '错误信息笼统：无法定位问题（"操作失败"）',
      '外部调用无超时：HTTP/DB 无 connect/read timeout',
      '资源未释放：异常分支未关闭连接/句柄',
      '错误泄露内部细节：暴露堆栈给客户端',
    ],
  },
  {
    key: 'boundary',
    name: '边界条件',
    description: '边界值、循环索引、类型语义、过拟合',
    weight: 0.10,
    checks: [
      '空数组处理：未考虑空数组场景',
      '除零：除法未考虑分母为 0',
      '分页异常：page=0、pageSize=0 未处理',
      '== 与 ===：弱类型语言类型混淆',
      'null/undefined 混用',
      '过拟合：硬编码 magic number / 假设特定数据',
    ],
  },
  {
    key: 'resource',
    name: '资源管理',
    description: '资源泄漏、超时缺失、内存与性能',
    weight: 0.10,
    checks: [
      '资源泄漏：异常分支未释放连接/句柄',
      '定时器未清理：setInterval 缺 clearInterval',
      '全局 Map 缓存无上限：可能导致内存泄漏',
      '外部 HTTP 无超时',
      'DB 查询无 statement_timeout',
      '大数据集全量加载：未用流式处理',
    ],
  },
  {
    key: 'testing',
    name: '测试质量',
    description: '测试有效性、覆盖度、断言有意义',
    weight: 0.08,
    checks: [
      'Happy path only：只测正常路径',
      '断言无意义：仅 expect().toBeTruthy()',
      'Mock 过度：测试的是 mock 而非真实逻辑',
      '未覆盖边界：空值/零值/极值/非法格式',
      '未覆盖错误分支',
      '状态流转非法跳转未测',
    ],
  },
  {
    key: 'architecture',
    name: '架构一致性',
    description: '幻觉 API、多文件一致性、代码重复、上下文丢失',
    weight: 0.10,
    checks: [
      '幻觉 API：调用的函数/库不存在于当前版本',
      'API 签名不一致：参数名/顺序与实际不符',
      '多文件一致性：Service 加参后 Controller 未同步',
      '代码重复：相同功能多份实现',
      '引入未使用的设计模式或抽象层',
      '命名冲突：与项目已有变量/模块重名',
    ],
  },
] as const;

export const CATEGORY_KEYS = DEFAULT_CATEGORIES.map((c) => c.key) as readonly CategoryKey[];

/** 严重度扣分表（与 DEFAULT_ANALYSIS_PROMPT 中的规则保持一致） */
export const SEVERITY_PENALTY: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', number> = {
  CRITICAL: 25,
  HIGH: 10,
  MEDIUM: 5,
  LOW: 1,
};

/**
 * 按问题列表计算单个类别的分数。
 *
 * 算法：
 *   1. 基础分 100 - Σ(每个问题的扣分)
 *   2. 上限保护：有任何 CRITICAL → ≤75；有任何 HIGH → ≤85；有任何 MEDIUM → ≤90
 *   3. 下限 0
 *   4. 零问题（没人扣分）→ 100（AI 仍可微调，但本算法不强制）
 */
export function computeCategoryScore(problems: Array<{ severity: string }>): number {
  let score = 100;
  let hasCritical = false;
  let hasHigh = false;
  let hasMedium = false;
  for (const p of problems) {
    const sev = p.severity;
    if (sev === 'CRITICAL') {
      score -= SEVERITY_PENALTY.CRITICAL;
      hasCritical = true;
    } else if (sev === 'HIGH') {
      score -= SEVERITY_PENALTY.HIGH;
      hasHigh = true;
    } else if (sev === 'MEDIUM') {
      score -= SEVERITY_PENALTY.MEDIUM;
      hasMedium = true;
    } else if (sev === 'LOW') {
      score -= SEVERITY_PENALTY.LOW;
    }
  }
  score = Math.max(0, score);
  if (hasCritical) score = Math.min(score, 75);
  else if (hasHigh) score = Math.min(score, 85);
  else if (hasMedium) score = Math.min(score, 90);
  return score;
}

/**
 * 计算 overall 分数（按权重加总）。
 * 权重和不必为 1 — 自动归一化。
 */
export function computeOverallScore(
  categoryScores: Record<CategoryKey, number>,
  weights: Partial<Record<CategoryKey, number>> = {},
): number {
  let weighted = 0;
  let weightSum = 0;
  for (const c of DEFAULT_CATEGORIES) {
    const w = weights[c.key] ?? c.weight;
    const s = categoryScores[c.key] ?? 0;
    weighted += w * s;
    weightSum += w;
  }
  return weightSum > 0 ? Math.round(weighted / weightSum) : 0;
}

// ─── Zod schema（AI 输出的校验） ─────────────────────────────────────────

export const ProblemSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const ProblemSchema = z.object({
  severity: ProblemSeveritySchema,
  /** 问题一句话描述（具体说明发现了什么） */
  message: z.string().max(500),
  /** 证据：哪段代码/哪行有问题（简短引用或位置描述，可空） */
  evidence: z.string().max(300).optional().default(''),
  /** 违背了哪条规则/最佳实践（如 "OWASP A03 注入"、"PRG 模式"） */
  violation: z.string().max(200).optional().default(''),
  /** 修复建议：具体怎么修（不要 "加 try/catch" 这种废话，要可执行步骤） */
  suggestion: z.string().max(1000).optional().default(''),
  filePath: z.string().max(500).optional().default(''),
  startLine: z.number().int().min(0).optional(),
  endLine: z.number().int().min(0).optional(),
});

export const CategoryReportSchema = z.object({
  key: z.enum(CATEGORY_KEYS as unknown as [CategoryKey, ...CategoryKey[]]),
  /** AI 给的 score（仅供参考，后端会重算） */
  score: z.number().min(0).max(100).optional(),
  /** 该类下的所有问题 */
  problems: z.array(ProblemSchema).default([]),
});

export const AnalysisOutputSchema = z.object({
  categories: z.array(CategoryReportSchema).length(8),
  /** 整体评价：指出最差的 2-3 个维度 + 优先修复顺序 */
  summary: z.string().max(2000).optional().default(''),
  /** AI 给的 overall（后端会重算） */
  overall: z.number().min(0).max(100).optional(),
});

export type Problem = z.infer<typeof ProblemSchema>;
export type CategoryReport = z.infer<typeof CategoryReportSchema>;
export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;

/** 计算类内问题统计（CRITICAL/HIGH/MEDIUM/LOW 各几个） */
export function severityCount(problems: Array<{ severity: string }>): Record<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW', number> {
  const c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const p of problems) {
    if (p.severity in c) c[p.severity as keyof typeof c]++;
  }
  return c;
}

/**
 * 标准化 AI 输出：宽松解析 + 补齐缺失类别（AI 可能漏报）+ 兜底乱码输入。
 * 即使 AI 漏报某类，也会创建一个 score=100、problems=[] 的占位条目。
 *
 * 解析失败的兜底策略（2026-09-09 修复）：
 *   - 返回全 100 分骨架，但 overall=-1（不是 100）作为失败信号，
 *     防止"全 100/0 问题"被用户误认为"满分报告"。
 *   - summary 写入原始 AI 输出前 300 字符，供用户在报告中查看。
 */
export function normalizeAnalysisOutput(parsed: unknown): AnalysisOutput {
  // 放宽 zod 验证：先允许任意 categories 长度，最后再补齐到 8
  const LenientSchema = AnalysisOutputSchema.extend({
    categories: z.array(CategoryReportSchema),
  });

  // 兜底空报告：解析失败时 overall=-1（≠100），前端据此显示"解析失败"警告
  const empty: AnalysisOutput = {
    categories: DEFAULT_CATEGORIES.map((c) => ({
      key: c.key,
      score: 100,
      problems: [],
    })),
    summary: '', // 解析失败时由调用方写入原始输出片段
    overall: -1, // ⚠️ -1 = 解析失败的信号，不是正常分数
  };

  if (!parsed || typeof parsed !== 'object') return empty;

  const result = LenientSchema.safeParse(parsed);
  if (!result.success) return empty;

  const seen = new Set(result.data.categories.map((c) => c.key));
  for (const def of DEFAULT_CATEGORIES) {
    if (!seen.has(def.key)) {
      result.data.categories.push({ key: def.key, score: 100, problems: [] });
    }
  }
  // 按固定顺序排序
  result.data.categories.sort((a, b) => {
    const ia = CATEGORY_KEYS.indexOf(a.key);
    const ib = CATEGORY_KEYS.indexOf(b.key);
    return ia - ib;
  });
  return result.data;
}
