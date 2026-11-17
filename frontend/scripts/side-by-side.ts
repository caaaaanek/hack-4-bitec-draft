// Склейка «наш екран ліворуч, еталон праворуч» у .ref/compare/<ім'я>.png.
// Запуск: npx tsx scripts/side-by-side.ts <наш-маршрут> <еталон> <ім'я> [ширина=1920] [висота=1080] [тема=light] [роль=leader]
// Потрібні запущений `npm run dev` (порт 5173) і еталонні скріншоти в .ref/ (npx tsx scripts/ref-capture.ts).
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const [
  route = '/',
  ref = 'overview',
  name = 'screen',
  w = '1920',
  h = '1080',
  theme = 'light',
  role = 'leader',
] = process.argv.slice(2)
const width = Number(w)
const height = Number(h)
const REF = join(process.cwd(), '.ref')
const refFile = join(REF, `${ref}-${width}x${height}-${theme}.png`)
if (!existsSync(refFile)) {
  console.error(`Немає еталона ${refFile}. Запустіть npx tsx scripts/ref-capture.ts`)
  process.exit(1)
}

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'uk-UA' })
  await ctx.addInitScript(
    ([t, r]) => {
      localStorage.setItem('iap-theme', t!)
      sessionStorage.setItem('demo.role', r!)
    },
    [theme, role],
  )
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:5173${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const ours = await page.screenshot({ fullPage: true })
  await ctx.close()

  const dir = join(REF, 'compare')
  mkdirSync(dir, { recursive: true })
  const out = await browser.newContext({ viewport: { width: width * 2 + 24, height } })
  const p2 = await out.newPage()
  const src = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`
  await p2.setContent(
    `<body style="margin:0;background:#888;display:flex;gap:24px;align-items:flex-start">
       <img src="${src(ours)}" style="width:${width}px"/>
       <img src="${src(readFileSync(refFile))}" style="width:${width}px"/>
     </body>`,
  )
  await p2.screenshot({ path: join(dir, `${name}.png`), fullPage: true })
  await browser.close()
  console.log(`Готово: .ref/compare/${name}.png (ліворуч наш, праворуч еталон)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
