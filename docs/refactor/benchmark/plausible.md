# plausible · Plausible 标杆调研

> 创建于 2026-09-07
> 借鉴价值：⭐⭐⭐⭐ （自托管分析，单 Next.js）

---

## 1. 一句话定位

**Plausible Analytics** 是开源、自托管、隐私优先的网站分析工具（28k+ stars）。

---

## 2. 关键事实（已确认）

- **GitHub**：https://github.com/plausible/analytics
- **Stars**：28,940
- **License**：AGPL-3.0
- **技术栈**：Elixir/Phoenix 后端 + Next.js 营销站 + ClickHouse（分析存储）

---

## 3. 借鉴要点

### 3.1 多语言 / 多服务架构

Plausible 不采用 monorepo——Elixir 后端 + Next.js 前端 + ClickHouse 是三个独立部署单元。

**借鉴**：

- AIHub 是单 Next.js 应用，没必要学 Plausible 的多服务架构
- 但 **ClickHouse 做分析存储** 这个思路可借鉴：未来 AIHub 的 `usage` 模块若数据量爆炸，可考虑分离到专用分析库

### 3.2 隐私优先（GDPR）

Plausable 不使用 cookie，IP 截断到城市级别，合规 GDPR / CCPA。

**借鉴**：AIHub 的 `usage` 模块存储 IP 时**必须**做同样处理（目前 schema 无 IP 字段，OK）。

### 3.3 自我托管友好

Plausible 提供 Docker Compose 一键部署，包含 Postgres + ClickHouse + Plausible server。

**借鉴**：未来 AIHub 若支持 self-hosted，需考虑 Docker Compose 打包。

---

## 4. 不借鉴的方面

| 项 | 原因 |
|---|---|
| ❌ Elixir/Phoenix 后端 | AIHub 锁 TypeScript |
| ❌ ClickHouse 分析存储 | 数据量未达临界 |
| ❌ 多服务架构 | AIHub 是单一 Vercel 部署 |

---

## 5. 对 AIHub 的具体建议

| 借鉴 | 应用 |
|---|---|
| GDPR / 隐私优先 | ✅ 已纳入原则（CLAUDE.md §3） |
| ClickHouse 分析存储 | ❌ 暂不需要 |
| Docker Compose 自托管 | 🟡 P3 远期增强 |
| 多服务架构 | ❌ 不采纳 |

---

## 6. 待用户补充

> **请用户在使用本调研前补充以下信息**：
>
> 1. Plausible 的 ClickHouse schema（具体表结构）
> 2. Plausible 的 GDPR 实施细节（IP 截断代码位置）
> 3. Plausible 的 Docker Compose 模板（具体 compose 文件）

---

## 7. 过期条件

- Plausible 改用 PostgreSQL 替代 ClickHouse（影响借鉴价值）
- AIHub 完成自托管支持（本调研归档）

---

**创建时间**：2026-09-07
**调研深度**：⭐⭐（基础事实确认 + 借鉴框架）
