'use client';

import { useRouter } from 'next/navigation';
import { IconArrowLeft } from '@tabler/icons-react';

interface BackButtonProps {
  /** 点击后跳转的路径，缺省时调用 router.back() */
  href?: string;
  /** 悬停 tooltip，可用于可访问性 */
  title?: string;
}

/**
 * 统一返回按钮
 *
 * 设计：
 *   - 34×34 圆角按钮（与其它工具按钮 size 一致）
 *   - hover 加深背景色 + 文字颜色
 *   - 默认调用 router.back()；若指定 href 则跳转到具体路径
 *
 * 使用场景：
 *   - 详情页（rankings/[id]、projects/[id]）
 *   - 创建页（projects/new）
 *   - 嵌套路由（避免点击 tab 后无路返回）
 */
export function BackButton({ href, title = '返回' }: BackButtonProps) {
  const router = useRouter();
  const onClick = () => {
    if (href) router.push(href);
    else router.back();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={
        'inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center ' +
        'rounded-md border bg-card text-foreground transition ' +
        'hover:bg-accent hover:border-foreground/30'
      }
    >
      <IconArrowLeft size={16} />
    </button>
  );
}
