'use client';

import { ThemeSettingsPanel } from '@/components/theme-settings-panel';

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function AppearancePanel() {
  return (
    <Section title="外观" subtitle="主题、强色调、自定义背景">
      <ThemeSettingsPanel />
      <div className="mt-4 rounded-lg border bg-card p-4 text-xs text-muted-foreground">
        <div className="mb-1 text-sm font-medium text-foreground">提示</div>
        主题会即时同步到所有设置。背景图上传到 Cloudflare R2 后会在所有设置中共用。
      </div>
    </Section>
  );
}
