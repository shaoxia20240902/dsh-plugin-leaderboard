/** Simplified Chinese copy for the sidebar panel. */
export const zh = {
  button: '插件榜',
  buttonAria: '打开社区插件排行榜',
  title: '插件排行榜',
  subtitle: 'GitHub topic dsh-plugin',
  hot: '最热',
  new: '最新',
  fire: '最火',
  loading: '正在读取 GitHub…',
  error: '暂时读不到排行榜。',
  retry: '重试',
  empty: '这一榜暂时没有条目。',
  stars: 'Star',
  forks: 'Fork',
  copy: '复制安装',
  interpret: '解读',
  copied: '已复制',
  interpreted: '已复制解读',
  open: '打开仓库',
  refresh: '刷新',
  sample: '样本 {total} 个仓库',
  heatHint: '最火按星标密度和近期活跃度取 Top 10。「解读」会复制一段提示词，粘到对话框即可让智能体 clone 仓库并用大白话讲解。第三方代码，安装前请阅读源码并钉住提交。',
  incomplete: 'GitHub 标记本次搜索不完整。',
} satisfies Record<string, string>

/** Locale key union. */
export type LeaderboardKey = keyof typeof zh

/** English copy. */
export const en = {
  button: 'Leaderboard',
  buttonAria: 'Open the community plugin leaderboard',
  title: 'Plugin leaderboard',
  subtitle: 'GitHub topic dsh-plugin',
  hot: 'Hottest',
  new: 'Newest',
  fire: 'On fire',
  loading: 'Reading GitHub…',
  error: 'The leaderboard is temporarily unavailable.',
  retry: 'Retry',
  empty: 'This board has no entries yet.',
  stars: 'Stars',
  forks: 'Forks',
  copy: 'Copy install',
  interpret: 'Explain',
  copied: 'Copied',
  interpreted: 'Prompt copied',
  open: 'Open repository',
  refresh: 'Refresh',
  sample: '{total} repositories sampled',
  heatHint: 'On fire is the top 10 by star density and recent activity. Explain copies a prompt you paste into the chat so the agent clones the repo and walks through it. Third-party code — review the source and pin a commit.',
  incomplete: 'GitHub marked this search incomplete.',
} satisfies Record<LeaderboardKey, string>
