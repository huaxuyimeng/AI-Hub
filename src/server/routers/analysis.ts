// 来源：d:\1Money\design\API设计.md §四 analysisRouter
// MVP：analysis + issue + score 的查询入口

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createHash } from 'crypto';
import { protectedProcedure, router } from '../context';
import { createTenantPrisma, prismaRaw } from '../../lib/db';
import { chooseModel, chat } from '../../lib/ai/router';
import { calculateCost } from '../../lib/ai/pricing';
import { recordUsage } from '../../lib/usage';
import {
  DEFAULT_CATEGORIES,
  ProblemSeveritySchema,
  computeCategoryScore,
  computeOverallScore,
  normalizeAnalysisOutput,
  type CategoryKey,
  type Problem,
  type AnalysisOutput,
} from '../../lib/analysis/categories';

// H-35 修复：复用 deep-code-audit 作为默认评审提示词，并支持用户自定义
// 参考：.cursor/skills/deep-code-audit/SKILL.md
// 报告输出格式：按 8 大类（安全/CRUD/并发/错误处理/边界/资源/测试/架构）分组
// 每类独立打分 + 该类所有问题列表（含 evidence / violation / suggestion）
// 最终 overall = 按权重加总（用户可在设置页调整权重）
const DEFAULT_ANALYSIS_PROMPT = `你是资深代码审查员。请对以下代码文件进行**深度、结构化、按维度**的静态审查。

## 评审维度（8 类，每类必须独立评分）

${DEFAULT_CATEGORIES.map((c, i) => {
  const checks = c.checks.map((ck, j) => `  ${j + 1}. ${ck}`).join('\n');
  return `### ${i + 1}. ${c.name}（key="${c.key}"）
描述：${c.description}
重点检查项：
${checks}`;
}).join('\n\n')}

## 评分规则

每个维度独立从 100 分开始：
- 每个 CRITICAL 问题扣 25 分
- 每个 HIGH 问题扣 10 分
- 每个 MEDIUM 问题扣 5 分
- 每个 LOW 问题扣 1 分
- 任何 CRITICAL 存在 → 该维度分数上限 75
- 任何 HIGH（无 CRITICAL）→ 该维度分数上限 85
- 任何 MEDIUM（无 HIGH/CRITICAL）→ 该维度分数上限 90
- 分数下限 0

最终 overall 是各维度按权重加总（权重详见 DEFAULT_CATEGORIES，前端会显示）。
**注意：你输出的 score 仅作为参考，后端会按上述规则重新计算。**

## 问题字段说明（每个问题必须包含）

| 字段 | 必填 | 说明 |
|---|---|---|
| severity | 必填 | "LOW" \| "MEDIUM" \| "HIGH" \| "CRITICAL" |
| message | 必填 | 一句话具体描述问题（不要"代码不好"，要"第 42 行直接拼接用户输入到 SQL，存在 SQL 注入"） |
| evidence | 推荐 | 简短引用代码片段或行号位置（如 "L42: db.execute(\\"SELECT * WHERE id='\\" + id)"） |
| violation | 推荐 | 违背了哪条规则/最佳实践（如 "OWASP A03:2021 注入" / "缺少幂等键" / "TOCTOU 时间窗口"） |
| suggestion | 推荐 | 具体修复步骤（不要"加 try/catch"，要"使用 prisma.\$queryRaw\`...\` 参数化查询"） |
| filePath | 推荐 | 完整路径 |
| startLine | 推荐 | 起始行号 |
| endLine | 可选 | 结束行号 |

## 评分风格

- **零问题代码极罕见**：大多数代码应在 40-85 分区间
- **不要给满分**：除非真的完美（极罕见）
- **整体评价**（summary 字段）：指出**最差的 2-3 个维度** + **优先修复顺序** + **整体判断**

## 输出格式（严格 JSON，无任何解释文字）

\`\`\`json
{
  "categories": [
    {
      "key": "security",
      "score": 60,
      "problems": [
        {
          "severity": "HIGH",
          "message": "第 42 行直接拼接用户输入到 SQL 查询，存在 SQL 注入",
          "evidence": "db.execute(\\"SELECT * FROM users WHERE id='\\" + userInput + \\"'\\")",
          "violation": "OWASP A03:2021 注入",
          "suggestion": "使用参数化查询：db.query(\\"SELECT * FROM users WHERE id = ?\\", [userInput])。若使用 Prisma 则用 prisma.user.findUnique({ where: { id } })",
          "filePath": "src/api/user.ts",
          "startLine": 42,
          "endLine": 42
        }
      ]
    },
    // ... 必须输出全部 8 个类别，没问题的类也输出（problems: []，score: 95-100）
    { "key": "crud", "score": 75, "problems": [...] },
    { "key": "concurrency", "score": 80, "problems": [...] },
    { "key": "errorHandling", "score": 70, "problems": [...] },
    { "key": "boundary", "score": 85, "problems": [...] },
    { "key": "resource", "score": 90, "problems": [...] },
    { "key": "testing", "score": 65, "problems": [...] },
    { "key": "architecture", "score": 88, "problems": [...] }
  ],
  "overall": 76,
  "summary": "整体评分偏低，主要问题是：1) 安全维度扣分最多，存在 SQL 注入风险，建议优先修复；2) 测试维度覆盖不足，缺少错误分支测试；3) 错误处理有静默吞错。建议按 安全 → 测试 → 错误处理 顺序修复。"
}
\`\`\`

**重要**：
- 必须输出全部 8 个类别（即使没发现问题）
- problems 是数组（无问题时为 []）
- 字段值必须严格符合类型（特别是 severity 必须是 4 个枚举之一）
- 不要在 JSON 前后添加任何 Markdown 装饰或解释文字`;

const IssueSeverity = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/**
 * 从 AI 输出中提取第一个完整 JSON 对象（Fix #11）。
 *
 * 替代原 `aiText.match(/\{[\s\S]*\}/)` 贪婪匹配 —— 后者会把多个 JSON 串成一个坏 JSON。
 * 本实现：从第一个 `{` 开始，括号深度归零时返回，能正确处理嵌套对象和转义引号。
 *
 * @returns 解析后的对象；找不到或解析失败返回 null
 */
function extractFirstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try { return JSON.parse(slice) as Record<string, unknown>; }
        catch { return null; }
      }
    }
  }
  return null;
}

/**
 * 解析用户自定义的 categoryWeights JSON。
 * 容错：null / 无效 JSON / 非对象 / 权重超出 [0, 1] 都视为未配置（用默认）。
 */
function parseWeightsJson(raw: string | null | undefined): Partial<Record<CategoryKey, number>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: Partial<Record<CategoryKey, number>> = {};
    for (const key of Object.keys(parsed) as CategoryKey[]) {
      const v = parsed[key];
      if (typeof v === 'number' && v >= 0 && v <= 1) {
        result[key] = v;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export const analysisRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), take: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      // Q1 修复：校验 project 归属当前租户，防止跨租户泄漏
      const owner = await prismaRaw.project.findFirst({
        where: { id: input.projectId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!owner) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });

      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const items = await prisma.analysis.findMany({
        where: { projectId: input.projectId },
        orderBy: { startedAt: 'desc' },
        take: input.take,
        include: { score: true, _count: { select: { issues: true } } },
      });
      return { items };
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });
      const item = await prisma.analysis.findFirst({
        where: { id: input.id, project: { tenantId: ctx.tenantId } },
        include: { score: true, issues: { orderBy: [{ severity: 'asc' }, { startLine: 'asc' }] }, project: { select: { id: true, name: true, slug: true } } },
      });
      if (!item) throw new TRPCError({ code: 'NOT_FOUND' });
      return item;
    }),

  run: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      files: z.array(z.object({
        path: z.string().min(1).max(500),
        language: z.string().max(50).optional(),
        content: z.string().max(50_000),
      })).min(1).max(50),
    }))
    .mutation(async ({ ctx, input }) => {
      const prisma = createTenantPrisma({ tenantId: ctx.tenantId });

      // 1. 校验 project 归属
      const owner = await prismaRaw.project.findFirst({
        where: { id: input.projectId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!owner) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });

      // 2. 落 analysis 记录
      const analysis = await prisma.analysis.create({
        data: {
          projectId: input.projectId,
          status: 'RUNNING',
          aiModel: chooseModel('code-analysis').model,
          startedAt: new Date(),
        },
      });

      // H-35: 读取用户自定义评审提示词（null 则用 deep-code-audit 默认规则）
      const userPrefs = await prismaRaw.userPreferences.findUnique({
        where: { userId: ctx.session.user.id },
        select: { analysisPrompt: true },
      });
      const systemPrompt = userPrefs?.analysisPrompt ?? DEFAULT_ANALYSIS_PROMPT;

      // 3. 跑 AI 分析
      const decision = chooseModel('code-analysis');

      // 整理检查文件清单（写入 breakdown，供报告展示"检查了哪些文件"）
      const checkedFiles = input.files.map((f) => ({
        path: f.path,
        sizeBytes: f.content.length,
        language: f.language ?? null,
      }));
      const totalBytes = checkedFiles.reduce((s, f) => s + f.sizeBytes, 0);

      // ⚠️ 关键修复：prompt schema 必须与 DEFAULT_ANALYSIS_PROMPT 保持一致。
      // 旧版用 `{"issues":[...]}` (flat list)，而 system prompt 要求输出 `{"categories":[...]}` (8 类分组)。
      // 两份契约矛盾 → AI 返回什么都无法完全满足 → 解析失败兜底 → 全 100/0 问题假象。
      // 修复：prompt 的 schema 示例改为 categories 结构，与 system prompt 完全对齐。
      const prompt =
        `请对以下代码文件做静态审查，按 8 大类分组输出严格 JSON（无任何解释文字）：\n` +
        `输出格式：\n` +
        `{"categories":[{"key":"security","score":85,"problems":[{"severity":"HIGH","message":"...","evidence":"...","violation":"...","suggestion":"...","filePath":"...","startLine":1,"endLine":2}]},...],"overall":82,"summary":"..."}\n\n` +
        `要求：\n` +
        `1. 必须输出全部 8 个类别（没问题的类也输出 score=95~100, problems=[]）\n` +
        `2. score 按 CRITICAL=-25/HIGH=-10/MEDIUM=-5/LOW=-1 扣分，下限 0；CRITICAL 存在上限 75，HIGH 上限 85，MEDIUM 上限 90\n` +
        `3. 零问题类应给 95~100（不要轻易给 100）\n` +
        `4. summary 指出最差的 2~3 个维度和优先修复顺序\n` +
        `5. 不要在 JSON 前后添加任何 Markdown 装饰或解释文字\n\n` +
        `---\n` +
        input.files.map((f) => `// ${f.path}\n${f.content}`).join('\n\n').slice(0, 40000);

      let aiText = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let isMock = false;
      try {
        const resp = await chat(
          decision.model,
          ctx.tenantId,
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          { temperature: 0.2, maxTokens: 4096 }
        );
        aiText = resp.content;
        inputTokens = resp.usage.input;
        outputTokens = resp.usage.output;

        // Fix #19 防御：AI 成功响应但 content 为空 → 多半是推理模型（reasoning_content
        //          用满 token、content 字段空），视为 AI 失败，走 fallback。
        //          否则用户拿到「0/100 + 0 问题 + 4096 token 消耗」的诡异结果。
        if (!aiText || aiText.trim() === '') {
          throw new Error(
            `AI returned empty content (model=${decision.model}, ` +
            `tokens=${inputTokens}/${outputTokens}). ` +
            `可能是推理模型（content 字段空，token 全在 reasoning_content）。` +
            `请改用非推理模型（如 deepseek-chat）。`,
          );
        }
      } catch (e) {
        // Q3 修复：与 chat.ts:113 保持一致——生产环境不可静默 fallback
        if (process.env.NODE_ENV === 'production') {
          await prismaRaw.analysis.update({
            where: { id: analysis.id },
            data: { status: 'FAILED', errorMessage: (e as Error).message, finishedAt: new Date() },
          });
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'AI service unavailable',
            cause: e,
          });
        }
        // dev 模式：返回 dev mock，避免 LiteLLM 不可达时开发体验中断
        // 与 chat.ts:113 对齐：mock 模式不入 UsageStat（估算值会污染账本），
        // Analysis 自身仍记 tokens=0 + costCents=0，便于调试期间一目了然"是 mock"
        isMock = true;
        // 新结构：mock 也按 8 类分组，分布在 3 个最常见维度上
        aiText = JSON.stringify({
          categories: [
            { key: 'security', score: 80, problems: [{
              severity: 'HIGH', message: `[dev-mock] ${input.files[0]?.path ?? '?'} 未走鉴权中间件`,
              evidence: 'app.use(handler) 无 auth guard',
              violation: '认证与授权碎片化',
              suggestion: '在路由上加 requireAuth() 中间件，或用统一鉴权包装器',
              filePath: input.files[0]?.path ?? '', startLine: 1, endLine: 5,
            }] },
            { key: 'crud', score: 85, problems: [{
              severity: 'MEDIUM', message: '[dev-mock] 数据库写入未包裹在事务中',
              evidence: 'await db.insert(a); await db.update(b); — 两步无事务',
              violation: '事务边界缺失',
              suggestion: 'await prisma.$transaction([db.insert(a), db.update(b)])',
              filePath: input.files[0]?.path ?? '', startLine: 1, endLine: 10,
            }] },
            { key: 'concurrency', score: 90, problems: [] },
            { key: 'errorHandling', score: 72, problems: [{
              severity: 'HIGH', message: '[dev-mock] catch 块为空',
              evidence: 'try { ... } catch (e) { /* TODO */ }',
              violation: '静默吞错',
              suggestion: 'catch (e) { logger.error({ err: e, context }); throw e; }',
              filePath: input.files[0]?.path ?? '', startLine: 1, endLine: 8,
            }] },
            { key: 'boundary', score: 100, problems: [] },
            { key: 'resource', score: 100, problems: [] },
            { key: 'testing', score: 70, problems: [{
              severity: 'MEDIUM', message: '[dev-mock] 测试只覆盖 happy path',
              evidence: 'test("creates user", () => { expect(ok).toBe(true) })',
              violation: '测试有效性不足',
              suggestion: '补充空值/异常/边界的测试用例',
              filePath: '', startLine: 0, endLine: 0,
            }] },
            { key: 'architecture', score: 95, problems: [] },
          ],
          overall: 84,
          summary: `[dev-mock] AI 响应异常：${(e as Error).message}。已生成 mock 评分（按 8 类分别打分）。`,
        });
        // mock 模式下不入账：tokens 保持 0，下方 costCents 自然为 0
      }

      // 4. 解析 AI 输出（按新 8 类结构）
      let analysisOutput: AnalysisOutput = normalizeAnalysisOutput(null); // 兜底初始化（parseFailed 时用到）
      let parseFailed = false; // 2026-09-09：标记解析是否失败（决定是否展示警告）
      let parseFailureReason = '';
      try {
        // Fix #11：AI 可能输出多个嵌套 JSON（贪婪匹配会把它们串成一个坏 JSON）。
        //          用括号计数找第一个完整 JSON 对象。
        const parsed = extractFirstJsonObject(aiText);
        if (!parsed) {
          parseFailed = true;
          parseFailureReason = 'AI 输出未找到合法 JSON 对象';
        } else {
          analysisOutput = normalizeAnalysisOutput(parsed);
          // 校验：normalize 后如果 overall=-1 即视为解析失败
          if (analysisOutput.overall === -1) {
            parseFailed = true;
            parseFailureReason = 'AI 输出结构与预期 schema 不符';
            analysisOutput.summary = `[解析失败] AI 输出前 300 字符：\n\n${aiText.slice(0, 300)}`;
          }
        }
      } catch (err) {
        parseFailed = true;
        parseFailureReason = (err as Error).message;
        analysisOutput = normalizeAnalysisOutput(null);
        analysisOutput.summary = `[解析异常] ${parseFailureReason}\n\n原始输出前 300 字符：\n\n${aiText.slice(0, 300)}`;
      }

      // 如果解析失败，写入 Analysis.errorMessage 便于后续排查
      if (parseFailed) {
        await prismaRaw.analysis.update({
          where: { id: analysis.id },
          data: { errorMessage: `parse_failed: ${parseFailureReason}` },
        });
      }

      // 读取用户自定义权重（默认走 DEFAULT_CATEGORIES）
      const userPrefsForWeights = await prismaRaw.userPreferences.findUnique({
        where: { userId: ctx.session.user.id },
        select: { categoryWeights: true },
      });
      const weights = parseWeightsJson(userPrefsForWeights?.categoryWeights);

      // **后端重算 score**（AI score 仅参考）
      // 2026-09-09 修复：解析失败时 overall=0 + 解析失败标记，避免"全 100/0 问题"假象
      const categoryScores: Record<CategoryKey, number> = {} as Record<CategoryKey, number>;
      for (const cat of analysisOutput.categories) {
        categoryScores[cat.key] = computeCategoryScore(cat.problems);
      }
      const overall = parseFailed
        ? 0
        : computeOverallScore(categoryScores, weights);

      // H-3 修复：整个 DB 写入流程包装在事务中——任何步骤失败全部回滚，
      //        避免 analysis 卡在 RUNNING 状态；并用批量操作消除 N+1
      const cost = isMock ? 0 : calculateCost(decision.model, inputTokens, outputTokens, 0);
      // H-35-Bug2：把 issuesCreated 提到外层（事务内计算，return 时需要）
      let issuesCreatedCount = 0;

      await prismaRaw.$transaction(async (tx) => {
        // 5a. 批量查已有文件（消除 N+1）
        const paths = input.files.map((f) => f.path);
        const existingFiles = await tx.file.findMany({
          where: { projectId: input.projectId, path: { in: paths }, deletedAt: null },
          select: { id: true, path: true },
        });
        const fileIdMap = new Map(existingFiles.map((f) => [f.path, f.id]));

        // 5b. 批量创建新文件（消除 N+1）
        const newFiles = input.files.filter((f) => !fileIdMap.has(f.path));
        if (newFiles.length > 0) {
          const createdFiles = await tx.file.createMany({
            data: newFiles.map((f) => {
              const contentHash = createHash('sha256').update(f.content, 'utf8').digest('hex');
              const safeName = f.path.replace(/[^a-zA-Z0-9._/-]/g, '_').replace(/^\/+/, '');
              return {
                projectId: input.projectId,
                path: f.path,
                language: f.language ?? null,
                sizeBytes: f.content.length,
                contentHash,
                r2Key: `projects/${input.projectId}/${contentHash.slice(0, 12)}-${safeName}`,
              };
            }),
          });
          // createMany 后重新查一次拿到 id（createMany 不返回 id）
          const created = await tx.file.findMany({
            where: {
              projectId: input.projectId,
              path: { in: newFiles.map((f) => f.path) },
              deletedAt: null,
            },
            select: { id: true, path: true },
          });
          created.forEach((f) => fileIdMap.set(f.path, f.id));
        }

        // 5c. 批量创建 issues（消除 N+1）
        // 把所有 8 类下的 problems 摊平后入库；category 字段记问题所属维度
        const allProblems: Array<Problem & { categoryKey: CategoryKey }> = [];
        for (const cat of analysisOutput.categories) {
          for (const p of cat.problems) {
            allProblems.push({ ...p, categoryKey: cat.key });
          }
        }
        const issueData = allProblems
          .map((i) => {
            const filePath = i.filePath ?? '';
            const fileId = filePath ? fileIdMap.get(filePath) : undefined;
            if (!fileId) return null; // 无 filePath 或 file 不存在 → 跳过（不让脏数据进库）
            const sevParse = ProblemSeveritySchema.safeParse(i.severity);
            return {
              analysisId: analysis.id,
              fileId,
              severity: sevParse.success ? sevParse.data : ('LOW' as const),
              // category 字段记人类可读维度名（不是 key），如 "安全漏洞"
              category: (DEFAULT_CATEGORIES.find((c) => c.key === i.categoryKey)?.name ?? '代码质量').slice(0, 50),
              message: i.message.slice(0, 500),
              suggestion: i.suggestion?.slice(0, 1000) ?? null,
              startLine: typeof i.startLine === 'number' ? i.startLine : null,
              endLine: typeof i.endLine === 'number' ? i.endLine : null,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        issuesCreatedCount = issueData.length; // 提到外层，供 return 使用
        if (issueData.length > 0) {
          await tx.issue.createMany({ data: issueData });
        }

        // 5d. 写 score（breakdown 升级为完整 8 类结构 + 权重元数据 + 文件清单 + 解析状态）
        await tx.score.create({
          data: {
            tenantId: ctx.tenantId,
            analysisId: analysis.id,
            algorithm: 'v1',
            overall,
            breakdown: JSON.stringify({
              summary: analysisOutput.summary,
              issueCount: issuesCreatedCount,
              // 2026-09-09 新增：标记解析失败，前端用此显示红色警告
              parseFailed,
              parseFailureReason: parseFailed ? parseFailureReason : null,
              // 2026-09-09 新增：检查清单（让报告回答"检查了哪些地方"）
              manifest: {
                fileCount: checkedFiles.length,
                totalBytes,
                files: checkedFiles,
                model: decision.model,
                inputTokens: parseFailed ? 0 : inputTokens,
                outputTokens: parseFailed ? 0 : outputTokens,
              },
              categories: analysisOutput.categories.map((cat) => ({
                key: cat.key,
                name: DEFAULT_CATEGORIES.find((c) => c.key === cat.key)?.name ?? cat.key,
                score: parseFailed ? 0 : categoryScores[cat.key],
                weight: weights[cat.key] ?? DEFAULT_CATEGORIES.find((c) => c.key === cat.key)?.weight ?? 0,
                problems: cat.problems.map((p) => ({
                  severity: p.severity,
                  category: cat.key,
                  message: p.message,
                  evidence: p.evidence ?? '',
                  violation: p.violation ?? '',
                  suggestion: p.suggestion ?? null,
                  filePath: p.filePath ?? '',
                  startLine: p.startLine ?? null,
                  endLine: p.endLine ?? null,
                })),
              })),
            }),
          },
        });

        // 5e. 更新 analysis 状态 + project latestScore
        await tx.analysis.update({
          where: { id: analysis.id },
          data: {
            status: 'COMPLETED',
            finishedAt: new Date(),
            inputTokens: BigInt(inputTokens),
            outputTokens: BigInt(outputTokens),
            costCents: Math.round(cost * 100),
          },
        });
        await tx.project.update({
          where: { id: input.projectId },
          data: { latestScore: overall },
        });
      });

      // 6. 触发 UsageStat（独立表，不在 analysis 事务中）
      if (!isMock) {
        await recordUsage({
          tenantId: ctx.tenantId,
          modelId: decision.model,
          inputTokens,
          outputTokens,
          cost,
          kind: 'analysis',
        });
      }

      return {
        analysisId: analysis.id,
        score: overall,
        // H-35-Bug2：原来硬编码 0，现在返回真实计数（后端存的是什么，前端就看到什么）
        issueCount: issuesCreatedCount,
        model: decision.model,
        // Fix #19：把 isMock 也返回前端，便于 UI 显示"dev-mock"徽标
        //          （用户就不会困惑"为什么评分是 72 但 token=0"）
        isMock,
        usage: { inputTokens, outputTokens, cost },
      };
    }),
});