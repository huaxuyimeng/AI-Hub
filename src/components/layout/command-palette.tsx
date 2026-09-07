'use client';

// 来源：.cursor/skills/workbench-ui-designer §6.2
// 全局命令面板 (Cmd+K / Ctrl+K / Esc)，仿 Trae 风
// S-02: description 只接收字符串（React 默认 escape），如未来要支持 i18n HTML，务必用 createElement 渲染，不要 dangerouslySetInnerHTML

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  IconHome,
  IconFolders,
  IconMessages,
  IconChartBar,
  IconPlug,
  IconSettings,
  IconSearch,
  IconArrowRight,
} from '@tabler/icons-react';
import type { TablerIconType } from '@/lib/icon-type';

interface Command {
  id: string;
  label: string;
  description?: string;
  icon: TablerIconType;
  href?: string;
  perform?: () => void;
  group: 'nav' | 'quick';
  keywords?: string[];
}

const NAV_COMMANDS: Command[] = [
  { id: 'go-workbench', label: '工作台', icon: IconHome, href: '/workbench', group: 'nav', keywords: ['home', 'dashboard'] },
  { id: 'go-projects', label: '项目', icon: IconFolders, href: '/projects', group: 'nav', keywords: ['project'] },
  { id: 'go-chat', label: '对话', icon: IconMessages, href: '/chat', group: 'nav', keywords: ['chat', 'conversation'] },
  { id: 'go-usage', label: '用量', icon: IconChartBar, href: '/usage', group: 'nav', keywords: ['usage', 'token'] },
  { id: 'go-plugins', label: '插件', icon: IconPlug, href: '/plugins', group: 'nav', keywords: ['plugin'] },
  { id: 'go-settings', label: '设置', icon: IconSettings, href: '/settings', group: 'nav', keywords: ['settings', 'preferences'] },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Cmd+K / Ctrl+K 打开，Esc 关闭（打开时也支持，承诺在 chat placeholder 中）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // 排除 IME 输入状态
      if (e.isComposing) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        // 强制失焦 textarea，否则浏览器 IME / composition 状态会吞掉事件
        const active = document.activeElement as HTMLElement | null;
        if (active && (active.tagName === 'TEXTAREA' || active.isContentEditable)) {
          active.blur();
        }
        // A-01 修复：打开前记录当前焦点，关闭后还原
        returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // A-01 修复：focus trap + 关闭后还原焦点
  useEffect(() => {
    if (!open) return;
    // 等下一帧让 input autoFocus 完，再接管 trap
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    function getFocusable(): HTMLElement[] {
      const root = dialogRef.current;
      if (!root) return [];
      return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (el) => !el.hasAttribute('disabled') && el.offsetParent !== null
      );
    }
    function handleTab(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const items = getFocusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !dialogRef.current?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !dialogRef.current?.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', handleTab);
    return () => {
      document.removeEventListener('keydown', handleTab);
      // 关闭后还原焦点到打开前的元素
      if (returnFocusRef.current && document.body.contains(returnFocusRef.current)) {
        returnFocusRef.current.focus();
      }
    };
  }, [open]);

  const filtered = NAV_COMMANDS.filter((c) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      c.label.toLowerCase().includes(q) ||
      c.keywords?.some((k) => k.toLowerCase().includes(q))
    );
  });

  useEffect(() => setSelectedIdx(0), [query, open]);

  function execute(c: Command) {
    setOpen(false);
    setQuery('');
    if (c.href) router.push(c.href);
    if (c.perform) c.perform();
  }

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/25 pt-[14vh] animate-fade-in"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
    >
      <div
        className="w-full max-w-lg rounded-xl border surface-elevated shadow-2xl animate-slide-down"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3">
          <IconSearch size={16} className="text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // C-13 修复：CJK 输入法组合态期间跳过方向键/Enter，避免吞掉 IME 选词
              const ne = e.nativeEvent as KeyboardEvent;
              if (ne.isComposing || ne.keyCode === 229) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && filtered[selectedIdx]) {
                e.preventDefault();
                execute(filtered[selectedIdx]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
              }
            }}
            placeholder="搜索页面、命令… (按 ESC 关闭)"
            className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            aria-label="搜索命令"
          />
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              没有匹配的命令
            </div>
          ) : (
            filtered.map((c, i) => {
              const Icon = c.icon;
              const active = i === selectedIdx;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => execute(c)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  className={
                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ' +
                    (active ? 'bg-primary/10 text-foreground' : 'text-foreground/80 hover:bg-accent')
                  }
                >
                  <Icon size={16} className={active ? 'text-primary' : 'text-muted-foreground'} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{c.label}</div>
                    {c.description && (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {c.description}
                      </div>
                    )}
                  </div>
                  {active && <IconArrowRight size={14} className="text-primary" />}
                </button>
              );
            })
          )}
        </div>
        <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
          <kbd className="rounded border bg-muted px-1 py-0.5">↑↓</kbd> 上下 ·{' '}
          <kbd className="rounded border bg-muted px-1 py-0.5">↵</kbd> 选择 ·{' '}
          <kbd className="rounded border bg-muted px-1 py-0.5">Esc</kbd> 关闭
        </div>
      </div>
    </div>
  );
}