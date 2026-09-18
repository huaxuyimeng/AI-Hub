'use client';

import { useState } from 'react';
import {
  IconUser,
  IconPalette,
  IconBell,
  IconUsers,
  IconCreditCard,
  IconKey,
  IconCopy,
  IconNews,
  IconChartBar,
  IconRobot,
  IconLock,
} from '@tabler/icons-react';
import type { TablerIconType } from '@/lib/icon-type';

import { AccountPanel } from '@/components/settings/AccountPanel';
import { AppearancePanel } from '@/components/settings/AppearancePanel';
import { NotificationsPanel } from '@/components/settings/NotificationsPanel';
import { TeamPanel } from '@/components/settings/TeamPanel';
import { BillingPanel } from '@/components/settings/BillingPanel';
import { ApiKeysPanel } from '@/components/settings/ApiKeysPanel';
import { NewsSettingsPanel } from '@/components/settings/NewsSettingsPanel';
import { RankingsSettingsPanel } from '@/components/settings/RankingsSettingsPanel';
import { ChatStylePanel } from '@/components/settings/ChatStylePanel';
import { AiKeysPanel } from '@/components/settings/AiKeysPanel';

type SectionId =
  | 'account'
  | 'appearance'
  | 'notifications'
  | 'ai-style'
  | 'news'
  | 'rankings'
  | 'team'
  | 'billing'
  | 'ai-keys'
  | 'rest-api'
  | 'data-cache';

const SECTIONS: { id: SectionId; label: string; icon: TablerIconType }[] = [
  { id: 'account',     label: '账号',      icon: IconUser },
  { id: 'appearance',   label: '外观',      icon: IconPalette },
  { id: 'notifications', label: '通知',    icon: IconBell },
  { id: 'ai-style',   label: 'AI对话风格', icon: IconRobot },
  { id: 'news',       label: '新闻',      icon: IconNews },
  { id: 'rankings',   label: '排行',      icon: IconChartBar },
  { id: 'team',       label: '团队',      icon: IconUsers },
  { id: 'billing',    label: '计费',      icon: IconCreditCard },
  { id: 'ai-keys',    label: 'AI模型Key',  icon: IconKey },
  { id: 'rest-api',   label: 'REST API',  icon: IconCopy },
  { id: 'data-cache', label: '数据与缓存', icon: IconLock },
];

export default function SettingsPage() {
  const [section, setSection] = useState<SectionId>('account');

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* 顶部标题栏 */}
      <div className="shrink-0 border-b bg-card px-8 py-4">
        <h1 className="text-lg font-semibold tracking-tight">设置</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">集中管理账号、外观、通知及 AI 配置</p>
      </div>

      {/* 移动端 select 切换 */}
      <div className="sticky top-0 z-50 shrink-0 border-b bg-background/95 backdrop-blur-sm md:hidden">
        <div className="px-4 py-2">
          <select
            id="settings-section"
            value={section}
            onChange={(e) => setSection(e.target.value as SectionId)}
            className="w-full rounded-md border bg-card px-3 py-1.5 text-sm"
          >
            {SECTIONS.map(({ id, label }) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 桌面端水平 tab 导航 */}
      <div className="sticky top-0 z-50 shrink-0 border-b bg-background/95 backdrop-blur-sm hidden md:block">
        <div className="mx-auto max-w-5xl px-8">
          <nav className="-mb-px flex gap-1 overflow-x-auto scrollbar-thin" aria-label="设置分类">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={
                  'group inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm transition ' +
                  (section === id
                    ? 'border-primary font-medium text-primary'
                    : 'border-transparent text-foreground/70 hover:border-foreground/30 hover:text-foreground')
                }
              >
                <Icon
                  size={16}
                  className={
                    'shrink-0 transition ' +
                    (section === id ? 'text-primary' : 'text-foreground/60 group-hover:text-foreground')
                  }
                />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
          <main className="min-w-0">
            {section === 'account'     && <AccountPanel />}
            {section === 'appearance'   && <AppearancePanel />}
            {section === 'notifications' && <NotificationsPanel />}
            {section === 'ai-style'    && <ChatStylePanel />}
            {section === 'news'        && <NewsSettingsPanel />}
            {section === 'rankings'    && <RankingsSettingsPanel />}
            {section === 'team'        && <TeamPanel />}
            {section === 'billing'     && <BillingPanel />}
            {section === 'ai-keys'     && <AiKeysPanel />}
            {section === 'rest-api'    && <ApiKeysPanel />}
            {section === 'data-cache'  && (
              <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
                此模块尚未启用。如需 PPT 锁定清理 / 90 天快照归档 / R2 孤儿扫描，请先实现
                <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">src/server/routers/cache.ts</code>
                的 5 个 procedure。
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
