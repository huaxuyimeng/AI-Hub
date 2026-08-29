// M-03 m / I18N-01 前置：集中 UI 文案，后续 i18n 时把值改成 t(key) 即可
export const COPY = {
  // 全局
  loading: '加载中…',
  retry: '重试',
  cancel: '取消',
  confirm: '确认',
  delete: '删除',
  save: '保存',
  create: '创建',
  done: '完成',
  close: '关闭',
  // 项目
  newProject: '新建项目',
  projectCount: (n: number) => `共 ${n} 个`,
  noProjects: '还没有项目',
  noProjectMatch: '没有匹配的项目',
  runAnalysis: '跑代码评测',
  analysisRunning: '分析中…',
  // 对话
  newChat: '新建',
  send: '发送',
  sendPlaceholder: '输入消息…',
  noChats: '没有对话 · 点 + 创建',
  noChatMatch: '没有匹配的对话',
  loadMore: '加载更多',
  // 欢迎
  greetingMorning: '早上好',
  greetingAfternoon: '下午好',
  greetingEvening: '晚上好',
  greetingNight: '夜深了',
  // 错误
  errorLoadFailed: '加载失败',
  errorNetwork: '网络连接失败，请检查网络',
  errorServer: '服务器异常，请重试',
  errorUnauthorized: '请先登录',
  errorForbidden: '权限不足',
  errorNotFound: '内容不存在',
  errorConflict: '数据冲突',
  errorRateLimit: '请求过于频繁，请稍后再试',
} as const;
