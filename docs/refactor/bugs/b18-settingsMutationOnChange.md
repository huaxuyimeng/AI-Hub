# b18-settingsMutationOnChange.md · BUG-18 低危：设置页每敲一个字符发一次 mutation

> 创建于 2026-09-07
> 严重性：🟢 低危
> 来源：[`docs/archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md`](../../archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md)

---

## 候选根因 #1（可能性：高）

- **现象**：onChange 直接 `updateMutation.mutate()`
- **证据**：`src/app/(app)/settings/page.tsx:739-744`
- **为什么可能是它**：每次 onChange 触发 render → mutate → 输入 "gpt-4o" 触发 6+ 次请求
- **如何验证**：打开 DevTools Network → 在 textarea 输入 → 看请求数
- **修复思路**：本地 state 暂存 + 防抖 800ms 提交（或 onBlur 提交）

---

## 候选根因 #2（可能性：中）

- **现象**：HTTP 乱序时旧值后到会覆盖新值
- **证据**：无请求版本号或 updatedAt 校验
- **为什么可能是它**：最终保存的可能不是用户输入
- **如何验证**：快速输入 → 等所有请求返回 → 检查最终值
- **修复思路**：提交前 diff 判断是否真的变了；用 React Query 的 `onMutate` + `onError` 乐观更新

---

## 修复方案（选 #1）

```tsx
// src/app/(app)/settings/page.tsx

// 改前：
<textarea
  value={data?.followedModels ?? ''}
  onChange={(e) => updateMutation.mutate({ followedModels: e.target.value })}
/>

// 改后：
const [localValue, setLocalValue] = useState(data?.followedModels ?? '');

const debouncedSave = useMemo(
  () => debounce((val: string) => {
    updateMutation.mutate({ followedModels: val });
  }, 800),
  [updateMutation]
);

<textarea
  value={localValue}
  onChange={(e) => {
    setLocalValue(e.target.value);
    debouncedSave(e.target.value);
  }}
  onBlur={() => {   // onBlur 也提交一次（防抖结束后可能还有残留）
    updateMutation.mutate({ followedModels: localValue });
  }}
/>
```

---

## 风险

- 防抖导致用户点"保存"时值还没提交（用 onBlur 兜底）
- debounce 在组件卸载时需清理

---

## 回归测试

| 场景 | 预期 |
|---|---|
| 快速输入 "gpt-4o" | 仅 1 次 mutation（防抖后） |
| 输入后立即失焦 | onBlur 触发 1 次 |
| 中途刷新页面 | 提交保存的值 |

---

**创建时间**：2026-09-07
