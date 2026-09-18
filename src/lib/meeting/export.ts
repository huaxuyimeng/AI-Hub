// 会议纪要导出工具（v1 — 2026-09-17）
//
// 支持格式：
//   - Markdown：纯文本 + Blob 下载
//   - HTML：富文本 + Blob 下载（用浏览器打开后另存为 PDF）
//   - DOCX：包装成 .doc（MIME application/msword），Word/WPS 能直接打开
//   - PDF：调用 window.print()（用户用浏览器"另存为 PDF"）
//
// 设计：零依赖。客户端纯函数导出。
//
// 过期条件：
//   - TranscriptEntry shape 变了 → buildMeetingMarkdown / buildMeetingHtml 都需调整
//   - 改这里时同步更新 .cursor/skills/workbench-ui-designer/SKILL.md §会议导出

// ── Types ──────────────────────────────────────────────────────────────────

interface TranscriptEntry {
  role: 'user' | 'assistant';
  content: string;
  model: string;
  speaker?: string;
  timestamp: string;
}

interface MeetingData {
  id: string;
  title: string | null;
  topic: string;
  status: string;
  conclusion: string | null;
  hostModel: string;
  createdAt: Date | string;
  participants: Array<{
    id: string;
    role: string;
    model: string;
    transcript: TranscriptEntry[] | null | unknown; // Prisma JsonValue
    order: number;
  }>;
}

// ── Markdown ──────────────────────────────────────────────────────────────

/**
 * 生成会议 Markdown 纪要
 * 结构：
 *   # 会议纪要：{title}
 *   > 主题：{topic}
 *
 *   ## 元数据
 *   - 时间 / 状态 / 主持人 / ID
 *
 *   ## 参与者发言
 *   ### 1. {role} ({model})
 *   {content}
 *
 *   ...
 *
 *   ## 主持人总结
 *   {conclusion}
 */
export function buildMeetingMarkdown(meeting: MeetingData): string {
  const lines: string[] = [];
  const title = meeting.title ?? meeting.topic.slice(0, 30);
  const created = new Date(meeting.createdAt).toLocaleString('zh-CN');

  lines.push(`# 会议纪要：${title}`);
  lines.push(``);
  lines.push(`> **主题**：${meeting.topic}`);
  lines.push(``);
  lines.push(`## 元数据`);
  lines.push(`- **时间**：${created}`);
  lines.push(`- **状态**：${meeting.status}`);
  lines.push(`- **主持人模型**：${meeting.hostModel}`);
  lines.push(`- **参与者**：${meeting.participants.length} 位`);
  lines.push(`- **会议 ID**：` + meeting.id);
  lines.push(``);

  lines.push(`## 参与者发言`);
  const sortedParticipants = [...meeting.participants].sort((a, b) => a.order - b.order);
  sortedParticipants.forEach((p, idx) => {
    const transcript = (p.transcript as TranscriptEntry[] | null) ?? [];
    const lastEntry = transcript[transcript.length - 1];
    lines.push(`### ${idx + 1}. ${p.role}（${p.model}）`);
    lines.push(``);
    if (lastEntry) {
      lines.push(lastEntry.content);
    } else {
      lines.push(`*（尚未发言）*`);
    }
    lines.push(``);
  });

  if (meeting.conclusion) {
    lines.push(`## 主持人总结`);
    lines.push(``);
    lines.push(meeting.conclusion);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*由 AIHub 生成于 ${new Date().toISOString()}*`);

  return lines.join('\n');
}

// ── HTML（可打印）──────────────────────────────────────────────────────────

export function buildMeetingHtml(meeting: MeetingData): string {
  const title = meeting.title ?? meeting.topic.slice(0, 30);
  const created = new Date(meeting.createdAt).toLocaleString('zh-CN');
  const sortedParticipants = [...meeting.participants].sort((a, b) => a.order - b.order);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>会议纪要：${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 800px; margin: 40px auto; padding: 0 40px; color: #1a1a1a; line-height: 1.7; }
    h1 { font-size: 28px; border-bottom: 3px double #6366f1; padding-bottom: 12px; }
    h2 { font-size: 20px; margin-top: 32px; color: #6366f1; border-left: 4px solid #6366f1; padding-left: 12px; }
    h3 { font-size: 16px; margin-top: 24px; color: #333; }
    .topic { background: #f5f5f7; border-left: 4px solid #1a1a1a; padding: 12px 16px; margin: 16px 0; font-style: italic; }
    .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 16px; margin: 16px 0; padding: 12px 16px; background: #fafafa; border-radius: 6px; font-size: 13px; }
    .meta b { display: inline-block; min-width: 90px; color: #555; }
    .participant { border: 1px solid #e5e5e5; border-radius: 6px; padding: 12px 16px; margin: 12px 0; }
    .participant-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
    .role { font-weight: 600; }
    .model { font-family: monospace; font-size: 12px; color: #888; background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
    .content { white-space: pre-wrap; font-size: 14px; line-height: 1.8; }
    .conclusion { border: 2px solid #6366f1; border-radius: 8px; padding: 16px 20px; margin: 24px 0; background: #f5f3ff; }
    .conclusion h2 { margin-top: 0; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 11px; color: #888; text-align: center; }
    @media print {
      body { margin: 0; padding: 20px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <h1>会议纪要：${escapeHtml(title)}</h1>
  <div class="topic">主题：${escapeHtml(meeting.topic)}</div>

  <h2>元数据</h2>
  <div class="meta">
    <div><b>时间</b>${escapeHtml(created)}</div>
    <div><b>状态</b>${escapeHtml(meeting.status)}</div>
    <div><b>主持人</b>${escapeHtml(meeting.hostModel)}</div>
    <div><b>参与者</b>${meeting.participants.length} 位</div>
  </div>

  <h2>参与者发言</h2>
  ${sortedParticipants
    .map((p, idx) => {
      const transcript = (p.transcript as TranscriptEntry[] | null) ?? [];
      const lastEntry = transcript[transcript.length - 1];
      const content = lastEntry ? lastEntry.content : '<i>（尚未发言）</i>';
      return `
      <div class="participant">
        <div class="participant-header">
          <span class="role">${idx + 1}. ${escapeHtml(p.role)}</span>
          <span class="model">${escapeHtml(p.model)}</span>
        </div>
        <div class="content">${escapeHtml(content)}</div>
      </div>`;
    })
    .join('\n')}

  ${
    meeting.conclusion
      ? `<div class="conclusion">
          <h2>主持人总结</h2>
          <div class="content">${escapeHtml(meeting.conclusion)}</div>
        </div>`
      : ''
  }

  <div class="footer">
    由 AIHub 生成于 ${new Date().toLocaleString('zh-CN')} · 会议 ID ${escapeHtml(meeting.id)}
  </div>
</body>
</html>`;
}

// ── DOCX（包装成 .doc）─────────────────────────────────────────────────────

/**
 * 用 HTML 嵌套 MS Word MIME，得到一个 Word/WPS 能直接打开的 .doc 文件
 * 严格说不是 OOXML，但兼容性很好（MS Office / WPS / Pages 都支持）
 */
export function buildMeetingDocFilename(meeting: MeetingData): string {
  const title = meeting.title ?? meeting.topic.slice(0, 30);
  const safe = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
  const dateStr = new Date(meeting.createdAt).toISOString().slice(0, 10);
  return `会议纪要_${safe}_${dateStr}.doc`;
}

// ── Public API：触发浏览器下载 ─────────────────────────────────────────────

export type ExportFormat = 'md' | 'html' | 'doc';

export interface ExportOpts {
  /** 浏览器侧限制：'pdf' 会调用 window.print()，浏览器选 PDF 打印机 */
  format: ExportFormat;
}

export function downloadMeetingExport(meeting: MeetingData, format: ExportFormat) {
  const baseTitle = (meeting.title ?? meeting.topic).slice(0, 30).replace(/[\\/:*?"<>|]/g, '_');
  const dateStr = new Date(meeting.createdAt).toISOString().slice(0, 10);
  const prefix = `会议纪要_${baseTitle}_${dateStr}`;

  if (format === 'md') {
    const blob = new Blob([buildMeetingMarkdown(meeting)], { type: 'text/markdown;charset=utf-8' });
    triggerDownload(blob, `${prefix}.md`);
    return;
  }

  if (format === 'html') {
    const blob = new Blob([buildMeetingHtml(meeting)], { type: 'text/html;charset=utf-8' });
    triggerDownload(blob, `${prefix}.html`);
    return;
  }

  if (format === 'doc') {
    // 用 .doc 格式（HTML inside MIME），Word/WPS 直接打开
    const html = buildMeetingHtml(meeting);
    const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
    triggerDownload(blob, `${prefix}.doc`);
    return;
  }
}

export function printMeetingAsPdf(meeting: MeetingData) {
  const html = buildMeetingHtml(meeting);
  const w = window.open('', '_blank');
  if (!w) {
    throw new Error('无法打开新窗口：请允许弹窗');
  }
  w.document.write(html);
  w.document.close();
  w.document.title = `会议纪要：${meeting.title ?? meeting.topic.slice(0, 30)}`;
  // 等资源加载完再触发打印
  setTimeout(() => {
    w.print();
  }, 300);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // 清理
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
