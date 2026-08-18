import { BOARD_COPY, parseBoardId } from './rank.ts'
import type { Board, BoardId, LeaderboardSnapshot, RankedPlugin } from './types.ts'

function formatStars(stars: number): string {
  if (stars >= 1000) return `${(stars / 1000).toFixed(stars >= 10_000 ? 0 : 1)}k`
  return String(stars)
}

function formatItem(item: RankedPlugin): string {
  const desc = item.description.length > 0 ? item.description : '(no description)'
  return [
    `${item.rank}. ${item.fullName}  ★${formatStars(item.stars)}  forks ${item.forks}`,
    `   ${desc}`,
    `   ${item.url}`,
    `   install: ${item.install}`,
  ].join('\n')
}

function formatBoard(board: Board | undefined): string {
  if (board === undefined) return ''
  if (board.items.length === 0) return `## ${board.title}\n\n暂无条目。`
  return [`## ${board.title}`, '', board.description, '', ...board.items.map(formatItem)].join('\n')
}

/**
 * Render one or all boards as Markdown for the slash command and the tool card.
 * @param snapshot - ranked boards
 * @param rawBoard - optional board selector
 */
export function formatLeaderboard(snapshot: LeaderboardSnapshot, rawBoard?: string): string {
  const selected = parseBoardId(rawBoard)
  const header = [
    `# dsh-plugin 排行榜`,
    ``,
    `来源：GitHub topic \`${snapshot.topic}\` · 样本 ${snapshot.total} 个仓库 · ${snapshot.fetchedAt}`,
    snapshot.incomplete ? 'GitHub 标记本次搜索结果不完整。' : '',
  ].filter(line => line.length > 0).join('\n')

  const boards: BoardId[] = selected === 'all' ? ['hot', 'new', 'fire', 'recommend'] : [selected]
  const body = boards.map(id => formatBoard(snapshot.boards[id])).join('\n\n')
  const legend = [
    '',
    `最热：${BOARD_COPY.hot.description}`,
    `最新：${BOARD_COPY.new.description}`,
    `最火：${BOARD_COPY.fire.description}`,
    '',
    '侧边栏点「解读」会复制一段提示词，粘到对话框即可让智能体 clone 仓库并用大白话讲解。',
    '打不开 GitHub 时：打开仓库走网页镜像；复制安装里带有代理克隆后再本地安装的命令。',
    '这些仓库是第三方代码。安装前请阅读源码，并用 `github:owner/repo#<sha>` 钉住提交。',
  ].join('\n')
  return `${header}\n\n${body}\n${legend}`
}
