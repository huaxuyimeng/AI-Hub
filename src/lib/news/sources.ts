/**
 * AI 新闻数据源配置
 *
 * 来源：整合 plan §3 + design/AI集成.md §10
 * 维护：编辑此文件可调整新闻源，新增/禁用、调整优先级
 *
 * 注意：所有 URL 必须是当前可达的 RSS / JSON API
 *       RSS 源优先于 HTML 抓取（结构稳定、维护成本低）
 */

export interface NewsSourceConfig {
  name: string;
  url: string;
  type: 'rss' | 'api' | 'html';
  priority: number;
  enabled?: boolean;
  notes?: string;
  /** HTML/正则源失败不阻断整批 */
  fragile?: boolean;
}

export const NEWS_SOURCES: NewsSourceConfig[] = [
  // 中文源（优先级高 - AI 浓度高、更新快）
  {
    name: '量子位',
    url: 'https://www.qbitai.com/feed',
    type: 'rss',
    priority: 10,
    notes: '国内 AI 媒体头部，每日 20+ 条',
  },
  {
    name: 'InfoQ AI',
    url: 'https://www.infoq.cn/feed.xml',
    type: 'rss',
    priority: 9,
    notes: '技术深度报道',
  },
  {
    name: 'AI科技评论',
    url: 'https://www.leiphone.com/feed',
    type: 'rss',
    priority: 9,
    notes: '新增于 2026-08-30：雷峰网旗下 AI 垂直媒体',
  },
  {
    name: '钛媒体',
    url: 'https://www.tmtpost.com/rss.xml',
    type: 'rss',
    priority: 8,
    notes: '新增于 2026-08-30：综合科技媒体，含大量 AI 内容',
  },
  {
    name: '极客公园',
    url: 'https://www.geekpark.net/rss',
    type: 'rss',
    priority: 8,
    notes: '修复于 2026-08-30：正确地址为 /rss 而非 /feed',
  },
  {
    name: '雷峰网',
    url: 'https://www.leiphone.com/feed',
    type: 'rss',
    priority: 8,
  },
  {
    name: 'AI Tech',
    url: 'https://www.aitntnews.com/ainews/rss.xml',
    type: 'rss',
    priority: 7,
  },
  {
    name: '橘鸦AI早报',
    url: 'https://daily.juya.uk/rss.xml',
    type: 'rss',
    priority: 7,
    enabled: false,  // 暂时禁用：域名无法访问（连接超时）
    notes: '每日 AI 新闻汇总（待网络环境可用时启用）',
  },
  {
    name: '橘鸦AI早报(公众号)',
    url: 'https://mp.weixin.qq.com/s/M1hoWNis5IRGrPsnkHshSw',
    type: 'html',
    priority: 9,
    notes: '橘鸦公众号每日 AI 早报（content_noencode 直解，无需 JS）',
  },
  {
    name: 'AI Bot',
    url: 'https://ai-bot.cn/daily-ai-news/',
    type: 'html',
    priority: 7,
    fragile: true,
    notes: 'HTML 抓取，需要针对性解析',
  },

  // 英文源（覆盖国际动态）
  {
    name: 'Hacker News AI (RSS)',
    url: 'https://hnrss.org/newest?q=AI',
    type: 'rss',
    priority: 8,
    notes: '新增于 2026-08-30：HN AI 关键词 RSS',
  },
  {
    name: 'TechCrunch AI',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    type: 'rss',
    priority: 7,
  },
  {
    name: 'MIT Tech Review AI',
    url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed',
    type: 'rss',
    priority: 7,
  },
  {
    name: 'Last Week in AI',
    url: 'https://lastweekin.ai/feed',
    type: 'rss',
    priority: 7,
    notes: '新增于 2026-08-30：每周 AI 简报，深度报道',
  },
  {
    name: 'VentureBeat AI',
    url: 'https://venturebeat.com/category/ai/feed/',
    type: 'rss',
    priority: 6,
    notes: '新增于 2026-08-30：企业 AI 报道',
  },
  {
    name: 'Google AI Blog',
    url: 'https://blog.google/technology/ai/rss/',
    type: 'rss',
    priority: 6,
    notes: '新增于 2026-08-30：Google 官方博客',
  },
  {
    name: 'The Verge AI',
    url: 'https://www.theverge.com/ai-artificial-intelligence',
    type: 'html',
    priority: 5,
    notes: '修复于 2026-08-30：专用 AI RSS 已失效，改用 HTML 抓取',
  },
  {
    name: 'Hacker News AI (API)',
    url: 'https://hn.algolia.com/api/v1/search?tags=story&query=AI',
    type: 'api',
    priority: 5,
    notes: 'Algolia Search API，需要定时刷新',
  },

  // AI IDE / 编程工具（2026-08-30 新增）
  {
    name: 'Cursor Changelog',
    url: 'https://cursor.com/changelog',
    type: 'html',
    priority: 8,
    fragile: true,
    notes: 'Cursor AI IDE 官方更新日志（HTML 抓取）',
  },
  {
    name: 'Qoder Blog',
    url: 'https://qoder.com/blog',
    type: 'html',
    priority: 7,
    fragile: true,
    notes: 'Qoder 智能体平台官方博客',
  },
  {
    name: 'Qoder CN',
    url: 'https://qoder.com.cn/blog',
    type: 'html',
    priority: 7,
    fragile: true,
    notes: 'Qoder 中国区官方博客',
  },
  {
    name: '通义千问',
    url: 'https://tongyi.aliyun.com',
    type: 'html',
    priority: 7,
    fragile: true,
    notes: '阿里通义千问/千问Code 官方页面',
  },
  {
    name: 'DeepSeek Blog',
    url: 'https://deepseek.com/blog',
    type: 'html',
    priority: 7,
    fragile: true,
    notes: 'DeepSeek / DeepSeek Harness 官方博客',
  },
  {
    name: 'Anthropic News',
    url: 'https://www.anthropic.com/news',
    type: 'html',
    priority: 6,
    fragile: true,
    notes: 'Anthropic / Claude Code 官方新闻',
  },
  {
    name: 'WorkBuddy',
    url: 'https://workbuddy.cn',
    type: 'html',
    priority: 6,
    fragile: true,
    notes: '腾讯 WorkBuddy 官方页面',
  },

  // AITNT 专用解析源（2026-09-01 新增）
  // 使用专门解析器：抓标题/URL/封面图/摘要/发布时间
  {
    name: 'AITNT-AI资讯',
    url: 'https://www.aitntnews.com/newList.html?typeId=1',
    type: 'html',
    priority: 9,
    fragile: true,
    notes: 'AITNT AI综合资讯（专用解析器，抓封面+摘要+时间）',
  },
  {
    name: 'AITNT-AI技术研报',
    url: 'https://www.aitntnews.com/newList.html?typeId=2',
    type: 'html',
    priority: 8,
    fragile: true,
    notes: 'AITNT AI技术深度报告（专用解析器）',
  },
  {
    name: 'AITNT-AI监管政策',
    url: 'https://www.aitntnews.com/newList.html?typeId=3',
    type: 'html',
    priority: 8,
    fragile: true,
    notes: 'AITNT 全球AI监管与政策法规（专用解析器）',
  },
  {
    name: 'AITNT-AI产品测评',
    url: 'https://www.aitntnews.com/newList.html?typeId=4',
    type: 'html',
    priority: 8,
    fragile: true,
    notes: 'AITNT AI产品实测与对比评测（专用解析器）',
  },

  // 钛媒体资讯（HTML 抓取，AI 关键词过滤）
  // 内容层次不齐，必须标题或摘要含 AI 关键词才入池
  {
    name: '钛媒体资讯',
    url: 'https://www.tmtpost.com/new',
    type: 'html',
    priority: 7,
    fragile: true,
    notes: '钛媒体最新资讯（专用解析器+AI关键词过滤，过滤无AI相关内容）',
  },

  // AIbase（2026-09-01 新增）
  // 专用 API：https://app.chinaz.com/.../ai/GetAiInfoList.aspx
  // Next.js 客户端渲染，RSS 不可用，必须走专用解析器
  {
    name: 'AIbase',
    url: 'https://www.aibase.com/zh/news',
    type: 'html',
    priority: 9,
    fragile: true,
    notes: 'AIbase AI资讯（chinaz API，专用解析器，priority=9 与量子位同级别）',
  },

  // 猫目（2026-09-01 新增）
  // 嵌入 Nuxt JSON 数据，专用解析器提取
  // 用户要求：标题/摘要必须含 AI 关键词（AI/agent/模型/厂商等）才入库
  {
    name: '猫目',
    url: 'https://maomu.com/news',
    type: 'html',
    priority: 7,
    fragile: true,
    notes: '猫目每日AI资讯（Nuxt JSON 专用解析器+AI关键词过滤）',
  },

  // AIHOT 日报（2026-09-01 新增）
  // RSS 质量高，每条目含分类、描述、原始时间
  {
    name: 'AIHOT',
    url: 'https://aihot.virxact.com/rss.xml',
    type: 'rss',
    priority: 8,
    notes: 'AIHOT 全网AI动态 RSS，分类丰富（AI模型/论文/产品/观点等）',
  },

  // AI Insight（2026-09-01 新增）
  // RSS 来自 60+ 海外 AI KOL 推文，每 8 小时自动更新
  {
    name: 'AI Insight',
    url: 'https://ai-insight.org/rss.xml',
    type: 'rss',
    priority: 8,
    notes: 'AI Insight 资讯 RSS，来自 60+ 海外 AI KOL 第一手推文',
  },

  // Unite.ai（2026-09-01 新增）
  // 中文站 AI 新闻，客户端渲染，专用解析器
  {
    name: 'Unite.ai',
    url: 'https://www.unite.ai/zh-cn/',
    type: 'html',
    priority: 8,
    fragile: true,
    notes: 'Unite.ai 中文站 AI 资讯（__NEXT_DATA__ + HTML 正则双解析）',
  },
];

/**
 * 分类关键词映射
 *
 * 来源：整合 plan §3 多源匹配阈值修正 + 设计文档 categoryKeywords
 * 用途：根据标题和摘要自动归类
 *
 * Bug修复（关键词重叠）：
 *   原版 AI Coding 和 AI IDE 共用 cursor/qoder/claude code 等大量关键词，导致同一条新闻
 *   在两个分类都得到分数，靠不稳定 sort 随机归类。
 *   现在每个关键词只归属于一个最匹配的分类（AI Coding 仅保留通用编程关键词，
 *   所有 IDE 产品名 / 公司名 移至 AI IDE 唯一归属）。
 *
 * Bug修复（英文标题0% 分类）：
 *   Hacker News AI 全部英文新闻没分类关键词覆盖，65% 新闻整体未分类。
 *   新增"通用 AI"关键词（如 ' ai ', 'llm', 'agent', 'model' 等）作为兜底归 AI Coding，
 *   让通用 AI 新闻也能落到分类里。
 */
export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  // AI Coding：通用编程 + AI 编程话题（不含具体 IDE 产品名）
  'AI Coding': [
    // 通用编程关键词（中英）
    '编程', '代码', 'code', 'programming', 'developer', 'coder', 'dev tools',
    // AI 编程助手（产品级，与"AI IDE"区分：这里指通用"AI 帮你写代码"话题）
    'copilot', 'copilot+', 'codex', 'github copilot', 'cline',
    // 通用 AI 关键词（英文新闻兜底归类）
    ' ai ', ' llm ', 'llm', 'agent', 'aigc', 'generative ai',
    // 编程范式
    'code generation', 'code review', 'refactor', 'software engineer',
  ],
  // AI IDE：具体 IDE 产品新闻（产品名 - 这些名字只在这里出现，避免重叠）
  'AI IDE': [
    // Cursor 生态
    'cursor', 'cursor ide', 'cursor harness', 'cursor origin',
    // Qoder 生态
    'qoder', 'qoder ide', 'qoder work',
    // 阿里系
    'qwen code', 'qwen-code', '千问code', '通义', 'tongyi',
    // DeepSeek 生态
    'deepseek harness', 'dsh', 'deepseek-coder',
    // OpenAI/ChatGPT Work
    'chatgpt work', 'openai work',
    // Anthropic/Claude Code
    'claude code',
    // WorkBuddy
    'workbuddy', '腾讯 workbuddy',
    // 其他 IDE
    'windsurf', 'aider', 'continue', 'tabnine', 'intellij', 'vscode',
    // 通用 IDE 关键词
    'ide', 'integrated development',
  ],
  '具身智能': [
    '具身', '机器人', '人形', 'embodied', 'robot', 'humanoid',
    'optimus', 'figure', 'physical intelligence', '1x',
    'unitree', '宇树', 'galbot', '银河通用',
  ],
  'AI政策': [
    'policy', 'regulation', '监管', '政策', '法案',
    'EU AI Act', 'AI Act', 'executive order', 'compliance',
    'law', 'legislation', 'lawsuit', 'ban',
  ],
};

/**
 * AI 厂家标签（2026-08-30 新增）
 *
 * 用途：自动识别新闻涉及的 AI 公司/组织，生成标签
 * 策略：先正则匹配（免费、快速），未匹配的复杂情况用 LLM 补完
 */
export const AI_COMPANIES: Array<{
  name: string;           // 标准化名称
  display: string;        // 显示名
  aliases: string[];      // 别名（用于匹配）
  type: 'lab' | 'bigtech' | 'startup' | 'opensource' | 'china';
}> = [
  // 美国大厂
  { name: 'openai', display: 'OpenAI', aliases: ['openai', 'chatgpt', 'gpt-4', 'gpt-4o', 'gpt-5', 'dall-e', 'sora'], type: 'bigtech' },
  { name: 'anthropic', display: 'Anthropic', aliases: ['anthropic', 'claude', 'claude-fable', 'claude-sonnet', 'claude-opus'], type: 'bigtech' },
  { name: 'google', display: 'Google', aliases: ['google', 'gemini', 'bard', 'deepmind', 'veo', 'google-ai'], type: 'bigtech' },
  { name: 'meta', display: 'Meta', aliases: ['meta', 'llama', 'facebook-ai', 'meta-ai', 'airobot'], type: 'bigtech' },
  { name: 'microsoft', display: 'Microsoft', aliases: ['microsoft', 'copilot', 'azure-ai', 'ms-copilot'], type: 'bigtech' },
  { name: 'amazon', display: 'Amazon', aliases: ['amazon', 'aws', 'bedrock', 'amazon-q', 'alexa-ai'], type: 'bigtech' },
  { name: 'apple', display: 'Apple', aliases: ['apple', 'apple-intelligence', 'siri-ai', 'ferret'], type: 'bigtech' },
  { name: 'nvidia', display: 'NVIDIA', aliases: ['nvidia', 'nims', 'tensorrt', 'cuda-ai'], type: 'bigtech' },
  { name: 'tesla', display: 'Tesla', aliases: ['tesla', 'optimus', 'dojo', 'fsd'], type: 'bigtech' },

  // 顶级 AI 实验室/初创
  { name: 'deepmind', display: 'DeepMind', aliases: ['deepmind', 'alphafold', 'gemini'], type: 'lab' },
  { name: 'xai', display: 'xAI', aliases: ['xai', 'grok', 'elon-musk-ai'], type: 'startup' },
  { name: 'mistral', display: 'Mistral', aliases: ['mistral', 'mixtral', 'le-chat'], type: 'startup' },
  { name: 'inflection', display: 'Inflection', aliases: ['inflection', 'pi-ai'], type: 'startup' },
  { name: 'cohere', display: 'Cohere', aliases: ['cohere', 'command-r'], type: 'startup' },
  { name: 'perplexity', display: 'Perplexity', aliases: ['perplexity', 'pplx'], type: 'startup' },
  { name: 'character', display: 'Character.AI', aliases: ['character.ai', 'character-ai'], type: 'startup' },
  { name: 'stability', display: 'Stability AI', aliases: ['stability', 'stable-diffusion', 'sdxl'], type: 'startup' },
  { name: 'midjourney', display: 'Midjourney', aliases: ['midjourney'], type: 'startup' },
  { name: 'runway', display: 'Runway', aliases: ['runway', 'gen-3'], type: 'startup' },
  { name: 'elevenlabs', display: 'ElevenLabs', aliases: ['elevenlabs'], type: 'startup' },

  // 中国大厂
  { name: 'deepseek', display: 'DeepSeek', aliases: ['deepseek', 'deep-seek'], type: 'china' },
  { name: 'alibaba', display: '阿里巴巴', aliases: ['alibaba', 'qwen', 'tongyi', '通义千问', 'dashscope'], type: 'china' },
  { name: 'baidu', display: '百度', aliases: ['baidu', 'ernie', '文心一言'], type: 'china' },
  { name: 'tencent', display: '腾讯', aliases: ['tencent', 'hunyuan', '混元'], type: 'china' },
  { name: 'bytedance', display: '字节跳动', aliases: ['bytedance', 'doubao', '豆包', 'trae', 'dola'], type: 'china' },
  { name: 'moonshot', display: '月之暗面', aliases: ['moonshot', 'kimi'], type: 'china' },
  { name: 'zhipu', display: '智谱', aliases: ['zhipu', 'glm', 'chatglm', '智谱清言'], type: 'china' },
  { name: 'minimax', display: 'MiniMax', aliases: ['minimax', 'abab', 'conch'], type: 'china' },
  { name: 'baichuan', display: '百川', aliases: ['baichuan', '百川智能'], type: 'china' },
  { name: 'sensetime', display: '商汤', aliases: ['sensetime', '日日新', '商汤'], type: 'china' },
  { name: '01-ai', display: '零一万物', aliases: ['01-ai', '零一万物', 'yi-'], type: 'china' },
  { name: 'iflytek', display: '科大讯飞', aliases: ['iflytek', '讯飞星火', 'spark-'], type: 'china' },
  { name: 'huawei', display: '华为', aliases: ['huawei', 'pangu', '盘古'], type: 'china' },
  { name: 'xiaomi', display: '小米', aliases: ['xiaomi', 'mi-ai'], type: 'china' },
  { name: 'unitree', display: '宇树', aliases: ['unitree', '宇树', 'h1'], type: 'china' },
  { name: 'galbot', display: '银河通用', aliases: ['galbot', '银河通用'], type: 'china' },

  // 开源/社区
  { name: 'huggingface', display: 'Hugging Face', aliases: ['huggingface', 'hugging-face', 'transformers'], type: 'opensource' },
  { name: 'ollama', display: 'Ollama', aliases: ['ollama'], type: 'opensource' },
  { name: 'pytorch', display: 'PyTorch', aliases: ['pytorch'], type: 'opensource' },
  { name: 'langchain', display: 'LangChain', aliases: ['langchain', 'langsmith'], type: 'opensource' },
  { name: 'llamaindex', display: 'LlamaIndex', aliases: ['llamaindex'], type: 'opensource' },

  // AI IDE / 编程工具（2026-08-30 新增）
  { name: 'cursor', display: 'Cursor', aliases: ['cursor', 'cursor ide', 'origin', 'cursor harness', 'cursor origin'], type: 'startup' },
  { name: 'qoder', display: 'Qoder', aliases: ['qoder', 'qoder ide', 'qoder work', 'qoder.cn'], type: 'startup' },
  { name: 'qwen-code', display: '千问Code', aliases: ['qwen code', 'qwen-code', '千问code', '通义千问'], type: 'china' },
  { name: 'deepseek-harness', display: 'DeepSeek Harness', aliases: ['deepseek harness', 'deepseek-harness', 'dsh'], type: 'opensource' },
  { name: 'workbuddy', display: 'WorkBuddy', aliases: ['workbuddy', '腾讯 workbuddy'], type: 'china' },
  { name: 'chatgpt-work', display: 'ChatGPT Work', aliases: ['chatgpt work', 'openai work'], type: 'startup' },
  { name: 'windsurf', display: 'Windsurf', aliases: ['windsurf', 'windsurf ide'], type: 'startup' },
  { name: 'continue', display: 'Continue', aliases: ['continue', 'continue.dev'], type: 'opensource' },
  { name: 'tabnine', display: 'Tabnine', aliases: ['tabnine'], type: 'startup' },
  { name: 'aider', display: 'Aider', aliases: ['aider', 'aider-chat'], type: 'opensource' },
];

/**
 * 从文本中提取 AI 厂家标签（正则匹配）
 * 混合策略：先正则匹配，复杂的用 LLM 补完
 */
export function extractCompanyTags(text: string): string[] {
  const lowerText = text.toLowerCase();
  const matched = new Set<string>();

  for (const company of AI_COMPANIES) {
    for (const alias of company.aliases) {
      if (lowerText.includes(alias.toLowerCase())) {
        matched.add(company.display);
        break;
      }
    }
  }

  return [...matched];
}
