# bilibili.md · bilibili 模块设计

> 创建于 2026-09-07
> 配套：[`00-总体迁移设计.md`](../00-总体迁移设计.md) §3.8

---

## 1. 一句话职责

B 站 UP 主监控 / 视频抓取 / WBI 签名 / RSSHub 兜底——`/bilibili`（推测路径）面板。

---

## 2. 当前代码位置

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/lib/bilibili/api.ts` | ~300 | 公开 API 调用 |
| `src/lib/bilibili/wbi.ts` | ~150 | WBI 签名（关键鉴权） |
| `src/lib/bilibili/rss.ts` | ~120 | RSSHub 兜底 |
| `src/lib/bilibili/storage.ts` | ~100 | 数据持久化 |
| `src/lib/bilibili/merge.ts` | ~80 | 跨源合并 |
| `src/lib/bilibili/scraper.ts` | ~400 | 编排层（api + rss + storage + merge） |
| `src/lib/bilibili/cookie.ts` | ~80 | Cookie 健康度 |
| `src/lib/bilibili/sources.ts` | ~100 | 源定义 |
| `src/lib/bilibili/subtitle.ts` | ~150 | 字幕抓取 |
| `src/server/routers/bilibili.ts` | ~100 | tRPC 入口 |

**合计**：~1580 行。

**关键修复**：

- 06-B站数据wbi签名-实施记录.md
- BUG-M：B 站 cookie 过期后爬虫静默失败（Problem Statement PS-04）

---

## 3. 目标包结构

```
packages/bilibili/
├── src/
│   ├── domain/
│   │   ├── video.ts                 # Video 类型
│   │   ├── uper.ts                  # UP 主类型
│   │   └── merge.ts                 # 跨源合并规则
│   ├── infra/
│   │   ├── api.ts                   # 公开 API（含 WBI）
│   │   ├── wbi.ts                   # WBI 签名算法
│   │   ├── rss.ts                   # RSSHub 兜底
│   │   ├── subtitle.ts              # 字幕抓取
│   │   ├── cookie.ts                # Cookie 健康度
│   │   └── storage.ts               # Prisma 封装
│   ├── interface/
│   │   ├── server/
│   │   │   ├── trpcRouter.ts        # routers/bilibili.ts 迁移
│   │   │   └── scraper.ts           # 编排层
│   │   └── ui/                      # (可选)
│   │       ├── BilibiliPanel.tsx
│   │       └── BilibiliNewsTab.tsx
│   └── index.ts
├── tests/
│   ├── wbi.spec.ts                  # WBI 签名算法
│   └── cookie.spec.ts               # Cookie 健康度
├── package.json
└── README.md
```

---

## 4. 对外 API（exports）

```json
{
  "exports": {
    ".":                  "./src/index.ts",
    "./interface/server": "./src/interface/server/trpcRouter.ts"
  }
}
```

**`src/index.ts` 暴露**：

```ts
export { bilibiliRouter } from './interface/server/trpcRouter';
export { scrapeBilibiliUps } from './interface/server/scraper';
export { checkCookieHealth } from './infra/cookie';
```

---

## 5. 依赖清单（dependency whitelist）

| 包 | 用途 |
|---|---|
| `@aihub/db` | Uper / Video 模型 |
| `@aihub/auth` | `protectedProcedure` |
| `@aihub/observability` | `logger` / `alert`（Cookie 过期告警） |

**禁止依赖**：

- ❌ `news`（bilibili 是独立的视频源，不与 news 混合）
- ❌ `chat` / `usage` / `projects` / `aiCore`

---

## 6. 消费方清单

| 包 | 引用方式 |
|---|---|
| `apps/web` | `/bilibili` 页面（如有） |
| `apps/cron` | `scrapeBilibiliUps`（Vercel Cron） |

---

## 7. 边界规则

1. ✅ WBI mixin key 必须每日更新（每日凌晨拉取一次）—— `wbi.ts`
2. ✅ Cookie 健康度：连续失败 N 次 → 告警 + 降级到 RSSHub
3. ⚠️ `scraper.ts` 是编排层（api ↔ rss ↔ storage ↔ merge）—— **严禁**把 WBI 算法逻辑塞进 scraper
4. ❌ 禁止 B 站 cookie 明文持久化（必须用 env / 数据库加密字段）
5. ❌ 禁止在 infra 层直接写日志用 console（必须用 @aihub/observability）

---

## 8. 迁移步骤

```bash
# P3.2 第 3 周（高风险：scraper 横跨多层）

mkdir -p packages/bilibili/src/{domain,infra,interface/server,interface/ui}
mkdir -p packages/bilibili/tests

# 1. 底层先迁：wbi → api → rss → cookie → subtitle → storage
cp src/lib/bilibili/wbi.ts packages/bilibili/src/infra/wbi.ts
cp src/lib/bilibili/api.ts packages/bilibili/src/infra/api.ts
cp src/lib/bilibili/rss.ts packages/bilibili/src/infra/rss.ts
cp src/lib/bilibili/cookie.ts packages/bilibili/src/infra/cookie.ts
cp src/lib/bilibili/subtitle.ts packages/bilibili/src/infra/subtitle.ts
cp src/lib/bilibili/storage.ts packages/bilibili/src/infra/storage.ts
cp src/lib/bilibili/sources.ts packages/bilibili/src/domain/sources.ts
cp src/lib/bilibili/merge.ts packages/bilibili/src/domain/merge.ts

# 2. 编排层：scraper
cp src/lib/bilibili/scraper.ts packages/bilibili/src/interface/server/scraper.ts
# 替换内部 import：./api → ./infra/api 等

# 3. tRPC router
cp src/server/routers/bilibili.ts packages/bilibili/src/interface/server/trpcRouter.ts

# 4. 全局替换
# @/lib/bilibili/* → @aihub/bilibili/*

pnpm --filter @aihub/bilibili typecheck
pnpm --filter @aihub/bilibili test
pnpm dev
```

---

## 9. 风险 + 缓解

| 风险 | 缓解 |
|---|---|
| scraper.ts 拆分后调用顺序错乱 | 单测覆盖 `scrapeBilibiliUps` 全流程 |
| WBI 算法变更 | `wbi.spec.ts` 用历史签名 fixture 回归 |
| Cookie 持久化加密 | infra/cookie.ts 内部用 `@aihub/db` 的加密字段（已有 AES） |
| RSSHub 公共实例不可用 | 未来支持自托管 RSSHub（env 注入地址） |

---

## 10. 验收清单

- [ ] `pnpm --filter @aihub/bilibili typecheck` 通过
- [ ] `pnpm --filter @aihub/bilibili test` 通过
- [ ] `pnpm dev` 后抓取 UP 主列表 → 入库成功
- [ ] Cookie 过期模拟测试 → alert 触发
- [ ] 删除 `src/lib/bilibili/*` 后 cron 仍跑通

---

## 11. 过期条件

- B 站 API 升级（WBI 算法变更）
- RSSHub 公共实例下线
- 引入 BV 号 → AV 号兼容
- 引入直播抓取

---

**创建时间**：2026-09-07
