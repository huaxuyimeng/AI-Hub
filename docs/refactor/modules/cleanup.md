# cleanup.md · cleanup 模块设计

> 创建于 2026-09-07
> 配套：[`00-总体迁移设计.md`](../00-总体迁移设计.md) §3.14

---

## 1. 一句话职责

孤儿文件扫描 / R2 清理 / 数据库清理统计——`/cleanup` 页面 + `cron:cleanup` 定时任务。

---

## 2. 当前代码位置

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/server/lib/cleanup-engine.ts` | ~400 | 清理核心逻辑 |
| `src/server/routers/cleanup.ts` | ~150 | tRPC 入口 |
| `src/components/cleanup/scan-panel.tsx` | ~200 | 扫描面板 UI |
| `src/components/cleanup/deep-panel.tsx` | ~200 | 深度清理面板 |
| `src/components/cleanup/report-panel.tsx` | ~150 | 报告面板 |
| `src/components/cleanup/shared.tsx` | ~100 | 共享 UI |
| `src/app/(app)/cleanup/page.tsx` | ~100 | 页面入口 |
| `src/scripts/cleanup-orphan-files.ts` | ~150 | 一次性脚本 |
| `src/lib/cleanup-db.ts` | ~200 | DB 端清理工具 |

**合计**：~1650 行。

---

## 3. 目标包结构

```
packages/cleanup/
├── src/
│   ├── domain/
│   │   ├── orphanTypes.ts           # 孤儿文件分类
│   │   └── cleanupPolicy.ts         # 清理策略（保留 N 天 / 跳过活跃）
│   ├── infra/
│   │   ├── r2Scanner.ts             # R2 端扫描
│   │   ├── dbScanner.ts             # DB 端扫描
│   │   └── cleanupExecutor.ts       # 实际删除执行（含 dry-run）
│   ├── interface/
│   │   ├── server/
│   │   │   ├── trpcRouter.ts        # routers/cleanup.ts 迁移
│   │   │   ├── cleanupEngine.ts     # engine 主体
│   │   │   └── cronJob.ts           # 定时任务入口
│   │   └── ui/
│   │       ├── ScanPanel.tsx
│   │       ├── DeepPanel.tsx
│   │       ├── ReportPanel.tsx
│   │       └── shared.tsx
│   └── index.ts
├── tests/
│   └── cleanupEngine.spec.ts        # 隔离 dry-run
├── package.json
└── README.md
```

---

## 4. 对外 API（exports）

```json
{
  "exports": {
    ".":                  "./src/index.ts",
    "./interface/server": "./src/interface/server/trpcRouter.ts",
    "./interface/ui":     "./src/interface/ui/index.ts"
  }
}
```

**`src/index.ts` 暴露**：

```ts
export { cleanupRouter } from './interface/server/trpcRouter';
export { runCleanupCron } from './interface/server/cronJob';
export type { OrphanStats } from './domain/orphanTypes';
```

---

## 5. 依赖清单（dependency whitelist）

| 包 | 用途 |
|---|---|
| `@aihub/db` | 多个模型（File / Analysis / Project 等） |
| `@aihub/auth` | `protectedProcedure` / `adminProcedure`（清理需 admin） |
| `@aihub/observability` | `logger` / `alert`（清理前告警） |
| `@aws-sdk/client-s3` | R2 端操作 |

**禁止依赖**：

- ❌ 业务包（news / rankings / chat 等）—— cleanup 是横切基础设施

---

## 6. 消费方清单

| 包 | 引用方式 |
|---|---|
| `apps/web` | `/cleanup` 页 |
| `apps/cron` | `runCleanupCron()`（定时执行） |

---

## 7. 边界规则

1. ✅ **dry-run 模式必须默认开启**——任何生产清理执行前必须先 dry-run 验证
2. ✅ 清理范围限定：`failedUpload` / `expiredBriefing` / `orphanR2` 三类（**严禁**扩展到任意表）
3. ✅ 清理前必须 Slack 告警（@aihub/observability/alert）
4. ⚠️ 清理后保留"撤销窗口"：删除的 R2 object 移动到 `.trash/` 前缀保留 7 天
5. ❌ 禁止 `adminProcedure` 之外的 procedure 执行清理
6. ❌ 禁止清理 User / Tenant / ApiKey（核心实体不可清理）

---

## 8. 迁移步骤

```bash
# P4.1 第 4 周

mkdir -p packages/cleanup/src/{domain,infra,interface/server,interface/ui}
mkdir -p packages/cleanup/tests

cp src/server/lib/cleanup-engine.ts packages/cleanup/src/interface/server/cleanupEngine.ts
cp src/server/routers/cleanup.ts packages/cleanup/src/interface/server/trpcRouter.ts
cp src/lib/cleanup-db.ts packages/cleanup/src/infra/dbScanner.ts

# R2 scanner（从 cleanup-engine.ts 抽出）
# cleanupExecutor 抽到 infra/cleanupExecutor.ts
# cron 入口抽到 interface/server/cronJob.ts

# UI 组件
cp src/components/cleanup/scan-panel.tsx packages/cleanup/src/interface/ui/ScanPanel.tsx
cp src/components/cleanup/deep-panel.tsx packages/cleanup/src/interface/ui/DeepPanel.tsx
cp src/components/cleanup/report-panel.tsx packages/cleanup/src/interface/ui/ReportPanel.tsx
cp src/components/cleanup/shared.tsx packages/cleanup/src/interface/ui/shared.tsx

# 替换全局 import
# @/server/lib/cleanup-engine → @aihub/cleanup
# @/lib/cleanup-db → @aihub/cleanup
# @/server/routers/cleanup → @aihub/cleanup/interface/server
# @/components/cleanup → @aihub/cleanup/interface/ui

pnpm --filter @aihub/cleanup typecheck
pnpm --filter @aihub/cleanup test
pnpm dev
```

---

## 9. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| 误删活跃用户的文件 | dry-run + 撤销窗口（7 天） |
| cleanupEngine 拆分漏掉某分支 | 单元测试覆盖所有 orphan 类型 |
| R2 删除失败导致孤儿增加 | 重试 + 失败告警 |

---

## 10. 验收清单

- [ ] `pnpm --filter @aihub/cleanup typecheck` 通过
- [ ] `pnpm --filter @aihub/cleanup test` 通过
- [ ] `/cleanup` 页加载正常
- [ ] dry-run 模式结果与生产一致
- [ ] `pnpm cron:cleanup` 跑通
- [ ] 删除 `src/server/lib/cleanup-engine.ts` 后仍正常

---

## 11. 过期条件

- 清理策略变 schema-driven（用户自定义保留期）
- 引入新清理目标类型（如 wallpaper 临时图）
- 切换 R2 兼容存储（如 AWS S3）
- 撤销窗口时长变更

---

**创建时间**：2026-09-07
