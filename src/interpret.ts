import type { PluginRepo } from './types.ts'

/** Fields needed to fill the default interpret prompt. */
export type InterpretTarget = Pick<PluginRepo, 'fullName' | 'name' | 'url' | 'description' | 'stars'>

/**
 * Default chat prompt: clone the repo, then explain it in plain language.
 * The user copies this into the Harness composer.
 */
export function interpretPrompt(repo: InterpretTarget): string {
  const description = repo.description.trim().length > 0 ? repo.description.trim() : '（仓库没有写简介）'
  const cloneDir = `/tmp/dsh-read-${repo.name}`
  return [
    `请解读这个 DeepSeek Harness 社区插件。先把它 clone 到临时目录，读完 README、package.json、cordis.patch.yml 和 src 入口，再用大白话讲给我听，让我读完就知道它是干什么的、值不值得装。`,
    ``,
    `仓库：${repo.fullName}`,
    `地址：${repo.url}`,
    `简介：${description}`,
    `Star：${repo.stars}`,
    `克隆：git clone --depth 1 ${repo.url}.git ${cloneDir}`,
    `安装：dsh plugin --profile web add github:${repo.fullName}`,
    ``,
    `写作要求：`,
    `- 用中文，结论先行，像给同事口头讲，不要写成发布会稿或功能清单。`,
    `- 术语第一次出现用人话解释；能不堆概念就不堆。看不懂或没看到的实现细节，直接写「可以先不用管」或「我没看到」，不要编。`,
    `- 先 clone 再读文件。README 和源码打架时，以源码为准，并点明差异。`,
    ``,
    `请按这个结构写：`,
    ``,
    `1. 一句话它是啥`,
    `2. 它解决什么烦（没有它，我平时会卡在哪）`,
    `3. 装进 Harness 之后，我在界面里能直接看到或用到什么`,
    `4. 核心就这几块（最多 3 块，每块 2～4 句人话）`,
    `5. 我现在怎么上手：执行上面的安装命令之后的前三步`,
    `6. 适合谁，不适合谁`,
    `7. 风险和边界：第三方代码、权限、要不要钉 commit`,
    ``,
    `最后用三句话收束：值不值得装、先试哪一个功能、有什么坑。`,
  ].join('\n')
}
