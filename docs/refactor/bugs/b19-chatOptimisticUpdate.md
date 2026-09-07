# b19-chatOptimisticUpdate.md · BUG-19 低危：chat 发送消息无乐观更新

> 创建于 2026-09-07
> 严重性：🟢 低危
> 来源：[`docs/archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md`](../../archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md)

---

## 候选根因 #1（可能性：高）

- **现象**：发送后清空输入但消息要等服务端往返才出现
- **证据**：`src/app/(app)/chat/page.tsx:162-174`
- **为什么可能是它**：无乐观更新，慢网下像"消息丢了"
- **如何验证**：用 slow 3G 节流 → 发消息 → 看消息何时出现
- **修复思路**：用 React Query `onMutate` 乐观插入用户消息

---

## 候选根因 #2（可能性：中）

- **现象**：`onSuccess` 里 `invalidate({ id: activeId! })` 取的是回调执行时刻的值
- **证据**：`chat/page.tsx:174`
- **为什么可能是它**：期间切换会话会刷新错会话
- **如何验证**：发送中切换会话 → 看 invalidate 刷了哪个
- **修复思路**：mutate 时闭包捕获发送时的 conversationId

---

## 修复方案（选 #1 + #2）

```tsx
// src/app/(app)/chat/page.tsx — sendMessage

// 改前：
const sendMessage = async () => {
  setInput('');
  const result = await sendMutation.mutateAsync({ conversationId: activeId!, content: input });
  // ...
};

// 改后（React Query onMutate 乐观更新）：
const sendMessage = () => {
  const capturedId = activeId!;
  const optimisticMsg = { id: `temp-${Date.now()}`, role: 'user' as const, content: input };
  setInput('');

  // 乐观插入
  queryClient.setQueryData(['chat', capturedId], (old) => ({
    ...old,
    messages: [...(old?.messages ?? []), optimisticMsg],
  }));

  sendMutation.mutate(
    { conversationId: capturedId, content: input },
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['chat', capturedId] });
      },
      onError: () => {
        // 回滚乐观插入
        queryClient.setQueryData(['chat', capturedId], (old) => ({
          ...old,
          messages: (old?.messages ?? []).filter(m => m.id !== optimisticMsg.id),
        }));
        setInput(input);  // 恢复输入
      },
    }
  );
};
```

---

## 风险

- 乐观更新的 temp ID 需要服务端返回的真实 ID 替换
- 并发发送两条消息时乐观 ID 唯一性

---

## 回归测试

| 场景 | 预期 |
|---|---|
| 慢网发消息 | 消息立即出现（乐观更新） |
| 消息发送成功 | 替换为真实消息 |
| 消息发送失败 | 回滚乐观消息 + 恢复输入 |
| 发送中切换会话 | 不影响发送（闭包捕获 ID） |

---

**创建时间**：2026-09-07
