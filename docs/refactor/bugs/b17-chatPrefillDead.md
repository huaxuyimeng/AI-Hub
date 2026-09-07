# b17-chatPrefillDead.md · BUG-17 中危：/chat?prefill= 是死参数

> 创建于 2026-09-07
> 严重性：🟡 中危
> 来源：[`docs/archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md`](../../archived/2026-09-root-docs/AIHub-Bug清单_2026_09_03.md)

---

## 候选根因 #1（可能性：高）

- **现象**：chat 页全文无 `useSearchParams`
- **证据**：`src/app/(app)/chat/page.tsx` 全文 grep `useSearchParams` = 0
- **为什么可能是它**：工作台「需求探索向导」生成的 prompt 通过 URL 传给 chat 页，但 chat 页根本不读这个参数
- **如何验证**：工作台点"去对话" → 输入框为空（不读取 prefill）
- **修复思路**：chat 页挂 `<Suspense>` 后 `useSearchParams().get('prefill')`，非空时填入输入框

---

## 候选根因 #2（可能性：中）

- **现象**：即使读取了 prefill，也无自动创建会话逻辑
- **证据**：chat 页只渲染消息列表和输入框，无 URL 参数处理
- **为什么可能是它**：参数读取了但没有触发 chat.create
- **如何验证**：手动加 `?prefill=hello` → 看是否有反应
- **修复思路**：读取 prefill → 若非空 → 自动创建 Conversation → 填入 input → 自动发送

---

## 修复方案（选 #1）

```tsx
// src/app/(app)/chat/page.tsx

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function ChatPage() {
  const searchParams = useSearchParams();
  const prefill = searchParams.get('prefill');

  // 首次加载时填入 prefill
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (prefill) {
      setInputValue(prefill);
    }
  }, [prefill]);

  // ...
}

export default function Page() {
  return (
    <Suspense fallback={<ChatLoadingSkeleton />}>
      <ChatPage />
    </Suspense>
  );
}
```

---

## 风险

- App Router 下 `useSearchParams` 必须包 `<Suspense>`
- prefill 含特殊字符（URL 编码）需解码

---

## 回归测试

| 场景 | 预期 |
|---|---|
| `/chat?prefill=hello` | 输入框显示 "hello" |
| `/chat`（无 prefill） | 输入框为空 |
| prefill 含中文 | URL 解码正确 |

---

**创建时间**：2026-09-07
