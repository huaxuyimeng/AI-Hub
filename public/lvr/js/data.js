/* ============================================================
 * LVR (LLM Value Ranking Lite) - Data Layer  (v2: 2026-08-28)
 *
 * Source grading (shown in detail modal):
 *   scoreSource:
 *     AA-LIVE     Artificial Analysis 模型页实时抓取 (2026-08-28)
 *     AA-SNAPSHOT AA 榜单快照 (2026-08-27，经 llm-value-rankings 项目交叉确认)
 *   priceSource:  各厂商官方定价页 / 官方文档 (2026-08)
 *   estimated:    字段为快照估计值时置 true，页面以 * 标注
 *
 * Intelligence = Artificial Analysis Intelligence Index v4.1.1
 *   (9 项评测加权：GDPval-AA v2 / τ³-Banking / Terminal-Bench v2.1 /
 *    SciCode / Humanity's Last Exam / GPQA Diamond / CritPt /
 *    AA-Omniscience / AA-LCR；智能体/编码/通用/科学推理各 25%)
 * ============================================================ */
window.LVR_DATA = {
  updatedAt: '2026-08-28',
  usdCny: 7.15,
  blendWeights: { input: 0.7, output: 0.3 }, // typical coding-agent token mix
  models: [
    /* ---------------- OpenAI ---------------- */
    {
      id: 'openai/gpt-5.6-sol', name: 'GPT-5.6 Sol', provider: 'OpenAI',
      intelligence: 60.9, speed: 70.3, priceInput: 5.00, priceOutput: 30.00,
      scoreSource: 'AA-LIVE',
      desc: 'GPT-5.6 系列旗舰（非 Pro 档），在复杂推理、编码与智能体任务上表现突出。',
      officialUrl: 'https://openai.com/api/', docsUrl: 'https://developers.openai.com/docs',
      apiKeyUrl: 'https://platform.openai.com/api-keys', priceSource: 'OpenAI 官方定价 (2026)'
    },
    {
      id: 'openai/gpt-5.5', name: 'GPT-5.5', provider: 'OpenAI',
      intelligence: 56.0, speed: 80.7, priceInput: 5.00, priceOutput: 30.00,
      scoreSource: 'AA-LIVE',
      desc: 'OpenAI 上一代旗舰，曾登顶 AA 智能指数，编码与智能体能力均衡强劲。',
      officialUrl: 'https://openai.com/api/', docsUrl: 'https://developers.openai.com/docs',
      apiKeyUrl: 'https://platform.openai.com/api-keys', priceSource: 'OpenAI 官方定价 (2026)'
    },
    {
      id: 'openai/gpt-5.6-terra', name: 'GPT-5.6 Terra', provider: 'OpenAI',
      intelligence: 56.6, speed: 107.7, priceInput: 2.00, priceOutput: 12.00,
      scoreSource: 'AA-LIVE',
      desc: 'GPT-5.6 系列中端主力，能力与吞吐量均衡，是多数通用 API 场景的默认选择。',
      officialUrl: 'https://openai.com/api/', docsUrl: 'https://developers.openai.com/docs',
      apiKeyUrl: 'https://platform.openai.com/api-keys', priceSource: 'OpenAI 官方定价 (2026)'
    },
    {
      id: 'openai/gpt-5.6-luna', name: 'GPT-5.6 Luna', provider: 'OpenAI',
      intelligence: 52.3, speed: 126.2, priceInput: 0.20, priceOutput: 1.20,
      scoreSource: 'AA-LIVE',
      desc: 'GPT-5.6 系列轻量高性价比型号：响应快、价格极低，适合高并发生产任务。',
      officialUrl: 'https://openai.com/api/', docsUrl: 'https://developers.openai.com/docs',
      apiKeyUrl: 'https://platform.openai.com/api-keys', priceSource: 'OpenAI 官方定价 (2026)'
    },
    /* ---------------- Anthropic ---------------- */
    {
      id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', provider: 'Anthropic',
      intelligence: 63.1, speed: 55.4, priceInput: 5.00, priceOutput: 25.00,
      scoreSource: 'AA-LIVE',
      desc: 'Anthropic 最强模型，擅长智能体工作流、长程任务与高难度编码，安全对齐业界领先。',
      officialUrl: 'https://www.anthropic.com/claude', docsUrl: 'https://platform.claude.com/docs',
      apiKeyUrl: 'https://console.anthropic.com/settings/keys', priceSource: 'Anthropic 官方定价 (2026)'
    },
    {
      id: 'anthropic/claude-fable-5', name: 'Claude Fable 5', provider: 'Anthropic',
      intelligence: 62.1, speed: 64.9, priceInput: 10.00, priceOutput: 50.00,
      scoreSource: 'AA-LIVE',
      desc: 'Anthropic 超旗舰档位，面向最苛刻的企业级推理与长程智能体任务，价格为全系最高。',
      officialUrl: 'https://www.anthropic.com/claude', docsUrl: 'https://platform.claude.com/docs',
      apiKeyUrl: 'https://console.anthropic.com/settings/keys', priceSource: 'Anthropic 官方定价 (2026)'
    },
    {
      id: 'anthropic/claude-opus-4.7', name: 'Claude Opus 4.7', provider: 'Anthropic',
      intelligence: 55.0, speed: 51.9, priceInput: 5.00, priceOutput: 25.00,
      scoreSource: 'AA-LIVE',
      desc: 'Opus 4 系列末代旗舰，能力依然一线，是 4.x 用户的稳定选择。',
      officialUrl: 'https://www.anthropic.com/claude', docsUrl: 'https://platform.claude.com/docs',
      apiKeyUrl: 'https://console.anthropic.com/settings/keys', priceSource: 'Anthropic 官方定价 (2026)'
    },
    {
      id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', provider: 'Anthropic',
      intelligence: 53, speed: 60, estimated: true, priceInput: 2.00, priceOutput: 10.00,
      scoreSource: 'AA-SNAPSHOT',
      desc: 'Claude 5 系列中端型号，多数任务接近旗舰而价格更低，编码智能体热门选择。',
      officialUrl: 'https://www.anthropic.com/claude', docsUrl: 'https://platform.claude.com/docs',
      apiKeyUrl: 'https://console.anthropic.com/settings/keys', priceSource: 'Anthropic 官方定价 (2026)'
    },
    {
      id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', provider: 'Anthropic',
      intelligence: 36.8, speed: 47.8, priceInput: 3.00, priceOutput: 15.00,
      scoreSource: 'AA-LIVE',
      desc: '4.x 系列中坚型号；在新版指数下分数回落，适合对价格敏感的存量集成。',
      officialUrl: 'https://www.anthropic.com/claude', docsUrl: 'https://platform.claude.com/docs',
      apiKeyUrl: 'https://console.anthropic.com/settings/keys', priceSource: 'Anthropic 官方定价 (2026)'
    },
    /* ---------------- Google ---------------- */
    {
      id: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', provider: 'Google',
      intelligence: 56.0, speed: 321.9, priceInput: 0.375, priceOutput: 1.875,
      scoreSource: 'AA-LIVE',
      desc: 'Google 快速多模态模型，面向编码与智能体场景深度优化，输出速度同级遥遥领先。',
      officialUrl: 'https://ai.google.dev/gemini-api', docsUrl: 'https://ai.google.dev/gemini-api/docs',
      apiKeyUrl: 'https://aistudio.google.com/apikey', priceSource: 'OpenRouter 官方页 (2026)'
    },
    {
      id: 'google/gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'Google',
      intelligence: 52.0, speed: 200.5, priceInput: 1.50, priceOutput: 9.00,
      scoreSource: 'AA-LIVE',
      desc: 'Gemini 3 系列上一代 Flash，200 tok/s 级吞吐，多模态与长上下文表现稳定。',
      officialUrl: 'https://ai.google.dev/gemini-api', docsUrl: 'https://ai.google.dev/gemini-api/docs',
      apiKeyUrl: 'https://aistudio.google.com/apikey', priceSource: 'Google 官方定价 (2026)'
    },
    {
      id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'Google',
      intelligence: 26.0, speed: 126.4, priceInput: 1.25, priceOutput: 10.00,
      scoreSource: 'AA-LIVE',
      desc: '2025 年旗舰；在新版指数下分数大幅回落，展示模型迭代速度——本页将其按规则剔除出排名。',
      officialUrl: 'https://ai.google.dev/gemini-api', docsUrl: 'https://ai.google.dev/gemini-api/docs',
      apiKeyUrl: 'https://aistudio.google.com/apikey', priceSource: 'Google 官方定价 (2026)'
    },
    /* ---------------- DeepSeek ---------------- */
    {
      id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'DeepSeek',
      intelligence: 52, speed: 58, estimated: true, priceInput: 0.14, priceOutput: 0.28,
      scoreSource: 'AA-SNAPSHOT',
      desc: 'DeepSeek 轻量旗舰，接近开源模型的定价提供稳定商用能力，缓存命中价低至 1%。',
      officialUrl: 'https://www.deepseek.com/', docsUrl: 'https://api-docs.deepseek.com/',
      apiKeyUrl: 'https://platform.deepseek.com/api_keys', priceSource: 'DeepSeek 官方定价 (2026)'
    },
    {
      id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'DeepSeek',
      intelligence: 53.2, speed: 66.3, priceInput: 1.74, priceOutput: 3.48,
      scoreSource: 'AA-LIVE',
      desc: 'DeepSeek 旗舰推理模型，复杂推理、数学与编码强劲，支持超长上下文与缓存计费优化。',
      officialUrl: 'https://www.deepseek.com/', docsUrl: 'https://api-docs.deepseek.com/',
      apiKeyUrl: 'https://platform.deepseek.com/api_keys', priceSource: 'DeepSeek 官方定价 (2026)'
    },
    /* ---------------- Z.ai (智谱) ---------------- */
    {
      id: 'z-ai/glm-5.3', name: 'GLM-5.3', provider: 'Z.ai (智谱)',
      intelligence: 59.5, speed: 76.6, priceInput: 1.40, priceOutput: 4.40,
      scoreSource: 'AA-LIVE',
      desc: '智谱旗舰大模型，支持自主智能体与长程任务，开源阵营综合能力前列。',
      officialUrl: 'https://z.ai/', docsUrl: 'https://docs.z.ai/',
      apiKeyUrl: 'https://bigmodel.cn/usercenter/apikeys', priceSource: 'AA 收录价格 (2026)'
    },
    {
      id: 'z-ai/glm-5.3-flash', name: 'GLM-5.3-Flash', provider: 'Z.ai (智谱)',
      intelligence: 57.5, speed: 50.2, priceInput: 0.15, priceOutput: 0.50,
      scoreSource: 'AA-LIVE',
      desc: 'GLM-5 系列轻量版，以极低价格提供接近旗舰的对话与编码能力，性价比突出。',
      officialUrl: 'https://z.ai/', docsUrl: 'https://docs.z.ai/',
      apiKeyUrl: 'https://bigmodel.cn/usercenter/apikeys', priceSource: 'AA 收录价格 (2026)'
    },
    /* ---------------- Moonshot / Qwen / MiniMax / xAI ---------------- */
    {
      id: 'moonshotai/kimi-k3', name: 'Kimi K3', provider: 'Moonshot AI',
      intelligence: 59.7, speed: 35.6, priceInput: 1.80, priceOutput: 7.20,
      scoreSource: 'AA-LIVE',
      desc: 'Moonshot AI 旗舰，2.8T 参数 MoE，1M 上下文，长文本理解与多模态推理见长。',
      officialUrl: 'https://www.kimi.com/', docsUrl: 'https://platform.moonshot.cn/docs',
      apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
      priceSource: '第三方收录官方挂牌价 $1.80/$7.20 (2026)'
    },
    {
      id: 'qwen/qwen3.8-max', name: 'Qwen3.8 Max', provider: 'Qwen (阿里云)',
      intelligence: 57.7, speed: 24.1, priceInput: 2.00, priceOutput: 6.00,
      scoreSource: 'AA-LIVE',
      desc: '阿里通义千问旗舰 MoE（2.4T 参数规模），1M 上下文，编码与智能体能力突出。',
      officialUrl: 'https://qwen.ai/', docsUrl: 'https://help.aliyun.com/zh/model-studio',
      apiKeyUrl: 'https://bailian.console.aliyun.com/', priceSource: '阿里云百炼官方定价 $2/$6 (2026)'
    },
    {
      id: 'minimax/minimax-m3', name: 'MiniMax M3', provider: 'MiniMax',
      intelligence: 45.4, speed: 113.9, priceInput: 0.30, priceOutput: 1.20,
      scoreSource: 'AA-LIVE',
      desc: 'MiniMax 新一代文本模型，解码极快、价格低廉，支持超长上下文，适合高吞吐场景。',
      officialUrl: 'https://www.minimax.io/', docsUrl: 'https://platform.minimax.io/docs',
      apiKeyUrl: 'https://platform.minimax.io/', priceSource: 'MiniMax 官方定价 (2026，50% 优惠后)'
    },
    {
      id: 'x-ai/grok-4.6', name: 'Grok 4.6', provider: 'xAI',
      intelligence: 60.9, speed: 57.8, priceInput: 2.00, priceOutput: 6.00,
      scoreSource: 'AA-LIVE',
      desc: 'xAI 旗舰，推理能力一线且定价激进，支持超大上下文，是高价旗舰的有力替代。',
      officialUrl: 'https://x.ai/', docsUrl: 'https://docs.x.ai/',
      apiKeyUrl: 'https://console.x.ai/', priceSource: 'xAI 官方定价 $2/$6 (2026)'
    }
  ]
};
