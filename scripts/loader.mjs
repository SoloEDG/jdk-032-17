// 无头运行专用：让 Node 识别 Vite 的 "@/" 别名与无扩展名相对导入
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { dirname, resolve as pathResolve } from 'node:path'

export async function resolve(specifier, context, nextResolve) {
  let next = specifier
  if (next.startsWith('@/')) {
    next = pathToFileURL(pathResolve(process.cwd(), 'src', next.slice(2))).href
  } else if ((next.startsWith('./') || next.startsWith('../')) && !/\.[cm]?[a-z]+$/i.test(next)) {
    const parentPath = fileURLToPath(context.parentURL)
    const base = pathResolve(dirname(parentPath), next)
    for (const ext of ['.ts', '.js']) {
      if (existsSync(base + ext)) {
        next = pathToFileURL(base + ext).href
        break
      }
    }
  }
  return nextResolve(next, context)
}
