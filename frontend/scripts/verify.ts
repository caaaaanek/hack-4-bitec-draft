// Перевірка екранів: npm run verify (після check). Збірку робить `npm run build` у складі verify.
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { preview } from 'vite'
import {
  FORBIDDEN_FRAGMENT,
  ROLES,
  WIDTHS,
  type VerifyRole,
  type VerifyRoute,
} from './verify-config.ts'

const OUT = join(process.cwd(), 'artifacts', 'screens')
const slug = (p: string) =>
  p === '/' ? 'home' : p.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-')

/** Висоти вікна для контрольних ширин: на 1280 і 1920 це 720 і 1080 (екрани 16:9). */
const HEIGHT: Record<number, number> = { 360: 800, 768: 1024, 1280: 720, 1920: 1080 }
/** Світла тема (основна) на всіх контрольних ширинах; темна на 1280x720 і 1920x1080 для всіх екранів. */
const themedWidths = (): [number, 'dark' | 'light'][] => [
  ...WIDTHS.map((w): [number, 'dark' | 'light'] => [w, 'light']),
  [1280, 'dark'],
  [1920, 'dark'],
]

interface Geometry {
  route: string
  sidebarLeft: number | null
  sidebarWidth: number | null
  mainLeft: number
  mainWidth: number
}
/** Геометрія каркаса за ключем «роль, ширина, тема»: має збігатися на всіх маршрутах ролі (допуск 1 px). */
const geometry = new Map<string, Geometry>()

async function readGeometry(page: Page, route: string): Promise<Geometry | null> {
  return page.evaluate((r) => {
    const main = document.querySelector('#main')
    if (!main) return null
    const nav = [...document.querySelectorAll('nav[aria-label="Основна навігація"]')].find(
      (n) => n.getBoundingClientRect().width > 0 && getComputedStyle(n).position === 'sticky',
    )
    const m = main.getBoundingClientRect()
    const n = nav?.getBoundingClientRect()
    return {
      route: r,
      sidebarLeft: n ? n.left : null,
      sidebarWidth: n ? n.width : null,
      mainLeft: m.left,
      mainWidth: m.width,
    }
  }, route)
}

function compareGeometry(key: string, g: Geometry): string[] {
  const first = geometry.get(key)
  if (!first) {
    geometry.set(key, g)
    return []
  }
  const out: string[] = []
  const diff = (a: number | null, b: number | null) =>
    a === null || b === null ? a !== b : Math.abs(a - b) > 1
  if (diff(first.sidebarLeft, g.sidebarLeft) || diff(first.sidebarWidth, g.sidebarWidth))
    out.push(`бічна панель відрізняється від ${first.route}`)
  if (diff(first.mainLeft, g.mainLeft) || diff(first.mainWidth, g.mainWidth))
    out.push(`колонка контенту відрізняється від ${first.route}`)
  return out
}

interface Result {
  role: string
  path: string
  problems: string[]
}

async function checkRoute(
  base: string,
  role: VerifyRole,
  route: VerifyRoute,
  browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<Result> {
  const problems: string[] = []
  const origin = new URL(base).origin
  for (const [width, theme] of themedWidths()) {
    const ctx = await browser.newContext({
      viewport: { width, height: HEIGHT[width] ?? 900 },
      locale: 'uk-UA',
    })
    const page = await ctx.newPage()
    const tag = `${width}px${theme === 'dark' ? ' dark' : ''}`
    await ctx.addInitScript((t) => localStorage.setItem('iap-theme', t), theme)
    const external = new Set<string>()
    page.on('request', (r) => {
      const u = r.url()
      if (/^(data|blob|about):/.test(u)) return
      if (new URL(u).origin !== origin) external.add(u)
    })
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`[${tag}] консоль: ${m.text()}`)
    })
    page.on('pageerror', (e) => problems.push(`[${tag}] помилка сторінки: ${e.message}`))
    try {
      if (role.setup) {
        await page.goto(origin + '/', { waitUntil: 'load' })
        await role.setup(page)
      }
      await page.goto(origin + route.path, { waitUntil: 'networkidle' })
      await page.waitForSelector(route.ready ?? '[data-ready="true"]', { timeout: 10_000 })
      await page.evaluate(() => document.fonts.ready)
      problems.push(...(await checkPage(page, tag, width)))
      if (route.path === '/' && role.id === 'leader') {
        // Дашборд: 1920x1080 без прокрутки, 1280x720 композиція за еталоном (три колонки) дає близько 620 px прокрутки, поріг 700
        const extra = await page.evaluate(
          () => document.documentElement.scrollHeight - window.innerHeight,
        )
        if (width === 1920 && extra > 1)
          problems.push(`[${tag}] дашборд прокручується на ${extra} px`)
        if (width === 1280 && extra > 700)
          problems.push(`[${tag}] дашборд прокручується на ${extra} px (більше 700)`)
      }
      const geo = await readGeometry(page, route.path)
      if (geo && !route.path.startsWith('/s/'))
        for (const p of compareGeometry(`${role.id}|${tag}`, geo)) problems.push(`[${tag}] ${p}`)
      const body = await page.evaluate(() => document.body.innerText)
      const isForbidden = body.includes(FORBIDDEN_FRAGMENT)
      if (route.forbidden && !isForbidden) problems.push(`[${tag}] очікувався ForbiddenState`)
      if (!route.forbidden && !route.showsForbiddenDemo && isForbidden)
        problems.push(`[${tag}] несподівано ForbiddenState`)
      if (route.contains && !body.includes(route.contains))
        problems.push(`[${tag}] немає тексту «${route.contains}»`)
      const dir = join(OUT, role.id, slug(route.path))
      mkdirSync(dir, { recursive: true })
      await page.screenshot({
        path: join(dir, `${width}${theme === 'dark' ? '-dark' : ''}.png`),
        fullPage: true,
      })
    } catch (e) {
      problems.push(`[${tag}] не готово: ${(e as Error).message.split('\n')[0]}`)
    }
    for (const u of external) problems.push(`[${tag}] зовнішній запит: ${u}`)
    await ctx.close()
  }
  return { role: role.id, path: route.path, problems }
}

async function checkPage(page: Page, tag: string, width: number): Promise<string[]> {
  const out: string[] = []
  const info = await page.evaluate(() => {
    const errors = [...document.querySelectorAll('[role="alert"], [data-error-card]')].filter(
      (e) => e.closest('[data-demo]') === null,
    )
    return {
      text: document.body.innerText,
      errorCards: errors.length,
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      lang: document.documentElement.lang,
    }
  })
  if (info.errorCards) out.push(`[${tag}] картки помилок: ${info.errorCards}`)
  if (info.text.includes('—')) out.push(`[${tag}] довге тире у видимому тексті`)
  if (/підприємств/i.test(info.text)) out.push(`[${tag}] слово «підприємство» у видимому тексті`)
  if (/рейтинг/i.test(info.text)) out.push(`[${tag}] слово «рейтинг» у видимому тексті`)
  if (/порушник|небезпечн|підозр|оцінка командира/i.test(info.text))
    out.push(`[${tag}] слово-ярлик у видимому тексті`)
  if (info.lang !== 'uk') out.push(`[${tag}] lang=${info.lang}`)
  if (width === 360 && info.scrollW > info.innerW)
    out.push(`[${tag}] горизонтальна прокрутка (${info.scrollW} > ${info.innerW})`)
  return out
}

/** Опитування від початку до подяки на 360 px: без горизонтальної прокрутки, цілі від 44 px. */
async function checkSurveyFlow(base: string, browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const problems: string[] = []
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'uk-UA' })
  const page = await ctx.newPage()
  const overflow = async (where: string) => {
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
    if (w[0]! > w[1]!) problems.push(`${where}: горизонтальна прокрутка (${w[0]} > ${w[1]})`)
  }
  try {
    await page.goto(new URL('/s/demo', base).href, { waitUntil: 'networkidle' })
    await overflow('екран гарантій')
    await page.getByRole('button', { name: 'Розумію, почати' }).click()
    for (let step = 0; step < 3; step++) {
      await overflow(`крок ${step + 1}`)
      const small = await page.evaluate(
        () =>
          [...document.querySelectorAll('fieldset label')].filter(
            (l) => l.getBoundingClientRect().height < 44,
          ).length,
      )
      if (small) problems.push(`крок ${step + 1}: цілей менше 44 px: ${small}`)
      if (step === 2) {
        await page.getByRole('button', { name: 'Надіслати' }).click()
        await page.getByText(/Залишилось відповісти на/).waitFor()
        await overflow('перелік пропущених')
      }
      const groups = await page.locator('fieldset').count()
      for (let g = 0; g < groups; g++)
        await page.locator('fieldset').nth(g).locator('label').nth(2).click()
      if (step < 2) await page.getByRole('button', { name: 'Далі' }).click()
    }
    await page.getByRole('button', { name: 'Надіслати' }).click()
    await page.getByText('Дякуємо. Ваші відповіді збережено анонімно.').waitFor()
    await overflow('екран подяки')
  } catch (e) {
    problems.push(`потік не пройдено: ${(e as Error).message.split('\n')[0]}`)
  }
  await ctx.close()
  return problems
}

async function main() {
  if (!existsSync(join(process.cwd(), 'dist'))) {
    console.error('Немає dist/. Запустіть npm run build (або npm run verify).')
    process.exit(1)
  }
  rmSync(OUT, { recursive: true, force: true })
  const server = await preview({ preview: { port: 4179, strictPort: true, host: '127.0.0.1' } })
  const base = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:4179/'
  const browser = await chromium.launch()
  const results: Result[] = []
  try {
    for (const role of ROLES)
      for (const route of role.routes) results.push(await checkRoute(base, role, route, browser))
    const flow = await checkSurveyFlow(base, browser)
    results.push({ role: 'respondent', path: 'потік опитування 360', problems: flow })
  } finally {
    await browser.close()
    await new Promise<void>((r) => server.httpServer.close(() => r()))
  }

  const rows = results.map((r) => [r.role, r.path, r.problems.length ? 'FAIL' : 'ready'])
  const w = [
    Math.max(4, ...rows.map((r) => r[0]!.length)),
    Math.max(6, ...rows.map((r) => r[1]!.length)),
  ]
  console.log(`${'роль'.padEnd(w[0]!)}  ${'екран'.padEnd(w[1]!)}  результат`)
  for (const r of rows) console.log(`${r[0]!.padEnd(w[0]!)}  ${r[1]!.padEnd(w[1]!)}  ${r[2]}`)
  const failed = results.filter((r) => r.problems.length)
  for (const r of failed) {
    console.log(`\n${r.role} ${r.path}:`)
    for (const p of r.problems) console.log(`  - ${p}`)
  }
  console.log(`\nСкріншоти: ${OUT}`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
