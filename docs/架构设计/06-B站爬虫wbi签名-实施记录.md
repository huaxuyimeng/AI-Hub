# 06 · B站爬虫 wbi 签名 + Cookie 注入 —— 实施记录

> **时间**：2026-09-01 21:25 (UTC+8)
> **问题**：本地 cron 跑通但 7 个 UP 主全部 -799/412，B站接口全部拒绝
> **结果**：✅ 22 条新闻成功入库，链路全部跑通
> **关联**：`docs/archived/36-D-1-B站爬虫完成报告.md`

---

## 一、根因分析

**三个独立原因**：

| 阶段 | 错误码 | 原因 |
|------|--------|------|
| ① 裸调 | 静默失败 | `listLatestVideos` 内 try/catch 吞掉所有异常 |
| ② 加日志 | HTTP 412 + `-799` | B站要求 **wbi 签名** + **登录态 cookie** |
| ③ 加 wbi 签名 | 部分 412 / 部分 -799 | 签名算法初版有 bug |
| ④ 修正 wbi 算法 | 全部 `-799` | 签名算法对了，但 cookie 被风控 |
| ⑤ 加间隔 3s → 5s | **成功** | burst 限流被绕过 |

---

## 二、修复方案

### 2.1 新增文件

| 文件 | 行数 | 作用 |
|------|------|------|
| `src/lib/bilibili/wbi.ts` | 128 | wbi 签名算法 + mixin key 缓存 |
| `src/lib/bilibili/cookie.ts` | 20 | 读环境变量拼 Cookie 头 |

### 2.2 修改文件

| 文件 | 改动 |
|------|------|
| `src/lib/bilibili/api.ts` | 3 处 fetch 加 Cookie 头；list 接口改用 `signWbi()` 包裹 URL |
| `src/lib/bilibili/scraper.ts` | UP 主循环加 5s 间隔 |
| `.env.local` | 新增 `BILI_SESSDATA`、`BILI_BILI_JCT`、`BILI_DEDE_USER_ID` |

### 2.3 wbi 签名算法

```
1. GET /x/web-interface/nav（带Cookie）→ 拿 wbi_img.img_url + sub_url
2. 提取 URL 中 /wbi/<key>.png 的 <key>（共32字符）
3. img_key + sub_key 按 MIXIN_KEY_ENC_TAB 偏移表重排 → mixin_key（32字符）
4. 待签名：query + wts=unix秒，过滤 ! ' ( ) *
5. 排序 → k1=v1&k2=v2&...
6. encodeURIComponent → md5(encoded + mixin_key) → w_rid
7. wts + w_rid 加回 URL
```

**易错点**：不要用 `encodeURIComponent` 处理单个 value 后再过滤特殊字符（顺序错）；`mixin key` 只有 32 位（不是 64 位）。

---

## 三、运维 SOP

### 3.1 Cookie 更换步骤

1. 浏览器登录 [bilibili.com](https://www.bilibili.com)
2. F12 → Application → Cookies → `https://www.bilibili.com`
3. 复制：`SESSDATA`、`bili_jct`、`DedeUserID`
4. 替换 `.env.local` 中的三个值
5. 重启 dev server（`kill -9` + `pnpm dev`，Next.js 不热重载 .env.local）
6. 触发 cron 验证

### 3.2 频率限制阈值（经验值）

| 场景 | 阈值 | 表现 |
|------|------|------|
| 未登录 | ~10 次/分钟 | -799 风控 |
| 登录 + cookie | ~50 次/小时 | 突发后 -799 |
| 登录 + 间隔 5s | **推荐生产值** | 几乎全通 |

### 3.3 排查 Checklist

```
□ .env.local 里三个 cookie 变量存在且不为空
□ dev server 用最新 .env.local 启动（kill -9 重启，Next.js 不热重载 env）
□ 日志有 `[wbi] mixin key refreshed: xxxxxxxx...` → wbi 签名正常
□ 日志有 412 → wbi 算法又算错了
□ 日志有 -799 → B站限流或风控
□ 日志有 -101 → cookie 过期
```

### 3.4 风控处置顺序

1. 等 5-30 分钟自动解封（推荐）
2. 换 SESSDATA（让 B站认为你是另一个人）
3. 临时降低 cron 频率：`0 */6 * * *` → `0 0,12 * * *`
4. 把 scraper 里的 sleep 间隔从 5s 改成 10s

---

## 四、风险提示

⚠️ **B站登录态 cookie 等同于账号密码**：
- ✅ 只写在 `.env.local`（已在 `.gitignore`）
- ✅ 用完后建议**修改 B站密码**（让旧 cookie 立即失效）
- ❌ 不要发到任何聊天群、issue、commit
- ❌ 不要截图包含 cookie 的内容

⚠️ **频率限制是 B站主动风控的**，不是系统 bug。单 cookie 每天 200-300 次调用是 B站公布的边界。7 UP × 每 6h = 28 次/天，远低于上限。
