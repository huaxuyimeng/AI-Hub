# b16-sidebarCollapseRace.md · BUG-16 中危：侧栏折叠状态被服务端偏好强制回滚

> 创建于 2026-09-07
> 严重性：🟡 中危
> 来源：[`docs/archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md`](../../archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md)

---

## 候选根因 #1（可能性：高）

- **现象**：useEffect 的 cleanup 每次依赖变化（含 `v`）都把 `hasSyncedRemoteRef.current` 重置为 false
- **证据**：`src/components/app-shell.tsx:348-364`
- **为什么可能是它**：用户先手动切换折叠 → `v` 变化 → cleanup 重置 flag → 服务端旧偏好到达 → 覆盖本地状态
- **如何验证**：手动折叠 → 等待服务端偏好推送 → 看是否回滚
- **修复思路**：同步 flag 的重置逻辑移出 cleanup（或 deps 去掉 `v`）；用户交互后以本地为准

---

## 候选根因 #2（可能性：中）

- **现象**：服务端偏好推送时机不确定，可能在用户交互后到达
- **证据**：推送无防抖
- **为什么可能是它**：网络延迟导致本地状态被覆盖
- **如何验证**：延迟推送场景测试
- **修复思路**：服务端偏好推送加时间戳对比，只接受更新的推送

---

## 修复方案（选 #1）

```tsx
// src/components/app-shell.tsx

// 改前：
useEffect(() => {
  return () => { hasSyncedRemoteRef.current = false; };
}, [v]);  // ← 问题：v 变化导致重置

// 改后：
// 用户交互后以本地为准，不受服务端偏好覆盖
const hasInteractedRef = useRef(false);
useEffect(() => {
  if (localCollapsed !== undefined) {
    hasInteractedRef.current = true;
  }
}, [localCollapsed]);

useEffect(() => {
  // 仅在"未交互"时同步服务端
  if (!hasInteractedRef.current && remoteValue !== undefined) {
    setLocalCollapsed(remoteValue);
  }
}, [remoteValue]);

useEffect(() => {
  return () => { hasSyncedRemoteRef.current = false; };
}, []);  // ← 移除 [v] 依赖，只在 unmount 时重置
```

---

## 风险

- 防抖回写服务端时，`localCollapsed` 变化频繁
- SSR 期间 `localCollapsed` 为 undefined

---

## 回归测试

| 场景 | 预期 |
|---|---|
| 手动折叠 → 等服务端推送 | 本地状态保持，不回滚 |
| 服务端先推送 → 用户再交互 | 本地覆盖服务端 |

---

**创建时间**：2026-09-07
