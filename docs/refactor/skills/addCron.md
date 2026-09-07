---
name: addCron
description: 新增定时任务（Vercel Cron / 独立 Worker）到 apps/cron。在用户提到「加个定时任务」「每晚跑 X」「每小时抓 Y」时必须触发。绝不直接写 route.ts——必须先评估锁、限流、失败重试。
---

# Add Cron Skill

## 1. 调用流程（严格顺序）

### Phase 1：任务定义

1. 任务名（kebab-case，如 `daily-summary`）
2. 频率（cron 表达式，如 `0 6 * * *`）
3. 职责（1 句话）
4. 依赖任务（顺序依赖？并行？）
5. 失败处理：告警 + 重试 + 跳过 / 终止

### Phase 2：风险评估

| 维度 | 评估 |
|---|---|
| 锁 | 是否需要分布式锁（防并发）？ |
| 限流 | 是否调用外部 API（需要限流）？ |
| 超时 | 预计执行时间 ≤ Vercel 函数时限？ |
| 数据量 | 处理 N 条数据？是否分片？ |

### Phase 3：实施

- 路由文件：`apps/cron/src/jobs/<name>.ts`
- 锁：调用 `withLock`（来自 @aihub/observability）
- 鉴权：`CRON_SECRET` header 校验
- 日志：`logger.info` + `logger.error`
- 告警：失败时调 `alert`（Slack）

### Phase 4：配置 vercel.json

```json
{
  "crons": [
    { "path": "/api/cron/<name>", "schedule": "<cron-expression>" }
  ]
}
```

## 2. 边界规则

- ✅ 所有 cron 必须 `protectedByCronSecret`
- ✅ 所有 cron 必须包 `withLock`（防并发重入）
- ❌ 禁止 cron 直接写 prisma（必须通过 packages/* 的 service）

## 3. 验收清单

- [ ] 锁冲突测试：并发触发 → 仅 1 次执行
- [ ] 失败重试：mock 外部 API 失败 → 告警 + 重试
- [ ] 鉴权测试：缺 CRON_SECRET → 401
- [ ] 文档：`docs/cron/<name>.md`（任务说明）

## 4. 过期条件

- 切换调度平台（Vercel Cron → k8s CronJob）
- 增加 Webhook 触发模式

---

**创建时间**：2026-09-07
