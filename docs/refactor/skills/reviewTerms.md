---
name: reviewTerms
description: 术语审核运营 SOP（TermDictionary verified 流转）。在用户提到「审核术语」「review terms」「术语质量」时必须触发。这是 P0 卡点（智能搜索功能生效依赖 verified=true 的术语）。
---

# Review Terms Skill

## 1. 业务背景

- `TermDictionary` 表存候选术语（来自 LLM 抽取 + 用户提交）
- `verified: true` 的术语才能被智能搜索使用
- 当前 `verified = 0` → 智能搜索空转（P0 卡点，见 37 报告 §2.2.9）

## 2. 调用流程

### Phase 1：拉取候选

```bash
pnpm tsx scripts/extract-terms.ts          # LLM 抽取新候选
pnpm tsx scripts/evaluate-terms.ts         # 评估质量分
```

### Phase 2：审核（人工）

打开 `scripts/review-terms.ts` 提供的 CLI（或 `prisma studio`）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `term` | ✅ | 术语名 |
| `category` | ✅ | company / model / concept / tech |
| `verified` | ✅ | true / false |
| `weight` | 可选 | 1-10，影响搜索排序 |
| `notes` | 可选 | 审核备注 |

每次审核 10-20 个高频词，单次 ≤ 30 分钟。

### Phase 3：流转

- `verified = true` → 自动注入到 `expandQuery()`，智能搜索立即生效
- `verified = false` → 不注入，但保留供后续复审
- 标记 `weight = 0` → 视为"白名单黑名单"，不参与搜索

### Phase 4：复审（每周）

```bash
# 检查上周新增候选
pnpm tsx scripts/review-terms.ts --since=7d
```

## 3. 验收清单

- [ ] 单次审核 10-20 个高频词
- [ ] `verified = true` 的术语被智能搜索正确消费
- [ ] 审核记录可追溯（带 reviewer + 时间戳）

## 4. 过期条件

- 切换到 AI 自动审核（高置信度自动 verified=true，低置信度人工）
- 引入多语言术语（中英双语）

---

**创建时间**：2026-09-07
