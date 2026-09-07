# b12-appSecretWeak.md · BUG-12 高危：密钥派生过弱 + APP_SECRET 无 fail-fast

> 创建于 2026-09-07
> 严重性：🔴 高危
> 来源：[`docs/archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md`](../../archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md)

---

## 候选根因 #1（可能性：高）

- **现象**：`crypto.ts:29` 用 `Buffer.alloc(32).fill(secret).fill(secret.slice(0,32))`
- **证据**：`src/lib/crypto.ts`（新建于 2026-09-03 的 CRITICAL 1 修复）
- **为什么可能是它**：fill 两次只取前 32 字节，多字节中文密语熵被截断；超过 32 字节的 secret 尾字节被截
- **如何验证**：用 50 字节 secret（`中文测试密钥超过三十二字节`）加密 → 解密 → 对比明文
- **修复思路**：`createHash('sha256').update(secret).digest()`（32 字节全熵利用）

---

## 候选根因 #2（可能性：中）

- **现象**：`APP_SECRET` 缺失时不在启动时报错，延迟到第一次加解密才崩
- **证据**：`src/lib/env.ts`（推测）无 `APP_SECRET` 校验
- **为什么可能是它**：env schema 缺 `APP_SECRET: z.string().min(16)` 的 fail-fast
- **如何验证**：删 `.env` 中的 APP_SECRET → 重启 dev → 看是否启动时报错
- **修复思路**：在 envSchema 加 `APP_SECRET: z.string().min(16).optional()` → 启动时校验非 optional

---

## 修复方案（选 #1 + #2）

```ts
// src/lib/crypto.ts

// 改前：
const key = Buffer.alloc(32).fill(secret).fill(secret.slice(0, 32));

// 改后：
import { createHash } from 'crypto';
const key = createHash('sha256').update(secret).digest();  // 始终 32 字节，全熵利用
```

```ts
// src/lib/env.ts — 追加
APP_SECRET: z.string().min(16),   // 必须存在，启动时 fail-fast
```

---

## 风险

- 已加密数据无法用新密钥解密（需要数据迁移）
- 切换密钥后旧加密数据全部失效

---

## 回归测试

| 场景 | 预期 |
|---|---|
| 32 字节 secret 加密解密 | roundtrip 成功 |
| 50 字节中文 secret 加密解密 | roundtrip 成功（修复前失败） |
| 删 APP_SECRET 后重启 dev | 启动时报 "APP_SECRET required" |
| `APP_SECRET=abc`（<16 字符）重启 | 启动时报 "APP_SECRET min 16" |

---

**创建时间**：2026-09-07
