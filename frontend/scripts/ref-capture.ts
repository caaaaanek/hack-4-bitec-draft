// Збір еталона: скріншоти й виміряні значення з макета колеги. Результат у .ref/ та docs/REFERENCE_TOKENS.md.
// Запуск: npx tsx scripts/ref-capture.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'

const URL = 'https://integrity-prototype.vercel.app/'
const OUT = join(process.cwd(), '.ref')
const ROUTES = [
  'overview',
  'index',
  'compare',
  'recs',
  'tracker',
  'checklist',
  'cycles',
  'survey',
  'me',
  'report',
  'audit',
]
const SIZES: [number, number][] = [
  [1920, 1080],
  [1280, 720],
]

/** [підпис, селектор, властивості] */
const PROBES: [string, string][] = [
  ['Сторінка (body)', 'body'],
  ['Заголовок h1', 'h1'],
  ['Заголовок картки h2', '.card h2'],
  ['Підпис-мітка (.lbl)', '.lbl'],
  ['Велике число (.big)', '.big'],
  ['Дробова частина (.dec)', '.dec'],
  ['Картка (.card)', '.card'],
  ['Сайдбар (.side)', '.side'],
  ['Бренд (.brand)', '.brand'],
  ['Логотип-значок (.logo)', '.logo'],
  ['Підпис групи меню (.nav-label)', '.nav-label'],
  ['Пункт меню', '.nav a, .nav button'],
  ['Активний пункт меню (.on)', '.nav .on'],
  ['Бейдж-лічильник (.badge)', '.nav .badge'],
  ['Картка ролі (.role-card)', '.role-card'],
  ['Селект ролі', '.role-card select'],
  ['Верхня панель (.top)', '.top'],
  ['Пігулка «Синтетичні дані» (.synthetic)', '.synthetic'],
  ['Кнопка циклу (.pill-btn)', '.pill-btn'],
  ['Круглий перемикач теми (.icon-btn)', '#themeBtn'],
  ['Аватар (.avatar)', '.avatar'],
  ['Пошук (.search)', '.search'],
  ['Пігулка статусу (.pill)', '.pill'],
  ['Пігулка поганого (.p-bad)', '.p-bad'],
  ['Пігулка доброго (.p-good)', '.p-good'],
  ['Пігулка попередження (.p-warn)', '.p-warn'],
  ['Нейтральна пігулка (.p-mute)', '.p-mute'],
  ['Дельта (.delta)', '.delta'],
  ['Іконка в колі (.comp-ic)', '.comp-ic'],
  ['Рядок участі (.part-row)', '.part-row'],
  ['Сегмент смуги участі (.part-row .f)', '.part-row .f'],
  ['Порожній сегмент (.part-row .f.e, .nodot)', '.part-row .f:last-child'],
  ['Рядок списку (.row)', '.row'],
  ['Заголовок таблиці (th)', 'th'],
  ['Комірка таблиці (td)', 'td'],
  ['Рядок таблиці (tr)', 'tbody tr'],
  ['Таблиця', 'table'],
  ['Кнопка основна (.pill-btn.ai-btn)', '.ai-btn'],
  ['Кнопка (button)', 'main button, .view button'],
  ['Інпут', 'input:not([type=checkbox]):not([type=radio])'],
  ['Селект', '.view select'],
  ['Сегмент-перемикач', '.seg, .segmented, [role=tablist]'],
  ['Підказка (.tip)', '.tip'],
  ['Шухляда (.drawer)', '.drawer'],
  ['Тост (.toast)', '.toast'],
  ['Рівнева смуга (.levelbar)', '.levelbar'],
]
const PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'color',
  'background-color',
  'border-top-width',
  'border-top-color',
  'border-top-left-radius',
  'box-shadow',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'gap',
  'width',
  'height',
]

async function measure(page: Page): Promise<Record<string, Record<string, string>>> {
  return page.evaluate(
    ([probes, props]) => {
      const out: Record<string, Record<string, string>> = {}
      for (const [label, sel] of probes as [string, string][]) {
        const el = document.querySelector(sel)
        if (!el) continue
        const cs = getComputedStyle(el)
        out[label] = Object.fromEntries((props as string[]).map((p) => [p, cs.getPropertyValue(p)]))
        out[label]!['_font-variant-numeric'] = cs.fontVariantNumeric
        out[label]!['_text'] = (el.textContent ?? '').trim().slice(0, 30)
      }
      return out
    },
    [PROBES, PROPS] as const,
  )
}

async function rootVars(page: Page, dark: boolean): Promise<string[]> {
  return page.evaluate((d) => {
    const out: string[] = []
    for (const ss of document.styleSheets) {
      try {
        for (const r of ss.cssRules as unknown as CSSStyleRule[]) {
          const t = r.selectorText
          if (!t) continue
          if (d ? t.includes('dark') : t === ':root') out.push(`${t} { ${r.style.cssText} }`)
        }
      } catch {
        /* чужий таблиця стилів */
      }
    }
    return out
  }, dark)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const measured: Record<string, Record<string, Record<string, string>>> = {}
  let fonts: string[] = []
  let varsLight: string[] = []
  let varsDark: string[] = []
  let darkWorks = false
  for (const [w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'uk-UA' })
    const page = await ctx.newPage()
    await page.goto(URL + '#overview', { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    if (w === 1920) {
      fonts = await page.evaluate(() => [
        ...new Set(
          [...document.fonts]
            .filter((f) => f.status === 'loaded')
            .map((f) => `${f.family} ${f.weight}`),
        ),
      ])
      varsLight = await rootVars(page, false)
      varsDark = await rootVars(page, true)
    }
    for (const dark of [false, true]) {
      if (dark) {
        await page.locator('#themeBtn').click()
        darkWorks = (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark'
        if (!darkWorks) break
      }
      for (const r of ROUTES) {
        await page.evaluate((x) => (location.hash = '#' + x), r)
        await page.waitForTimeout(900)
        await page.screenshot({
          path: join(OUT, `${r}-${w}x${h}-${dark ? 'dark' : 'light'}.png`),
          fullPage: false,
        })
        if (w === 1920 && !dark) {
          const m = await measure(page)
          for (const [k, v] of Object.entries(m)) measured[k] ??= { [r]: v }
          if (r === 'overview') {
            const side = await page.locator('.side').boundingBox()
            const top = await page.locator('.top').boundingBox()
            measured['_геометрія'] = {
              overview: {
                'ширина сайдбара': `${side?.width}`,
                'висота верхньої панелі': `${top?.height}`,
              },
            }
          }
        }
      }
    }
    await ctx.close()
  }
  await browser.close()

  const md: string[] = [
    '# Еталон: виміряні значення',
    '',
    'Джерело: https://integrity-prototype.vercel.app (макет колеги). Знято `npx tsx scripts/ref-capture.ts`: `getComputedStyle` на 1920x1080, світла тема. Скріншоти еталона лежать у `.ref/` (у git не потрапляють).',
    '',
    '## Шрифти (document.fonts, статус loaded)',
    '',
    ...fonts.map((f) => `- ${f}`),
    '',
    `Перемикач теми працює: ${darkWorks ? 'так (data-theme="dark")' : 'ні'}.`,
    '',
    '## CSS-змінні макета, світла тема',
    '',
    '```css',
    ...varsLight,
    '```',
    '',
    '## CSS-змінні макета, темна тема',
    '',
    '```css',
    ...varsDark,
    '```',
    '',
    '## Елемент: значення',
    '',
  ]
  for (const [label, byRoute] of Object.entries(measured)) {
    const [route, vals] = Object.entries(byRoute)[0]!
    md.push(`### ${label} (маршрут #${route})`, '', '| Властивість | Значення |', '| --- | --- |')
    for (const [k, v] of Object.entries(vals)) md.push(`| ${k} | ${v.replace(/\|/g, '/')} |`)
    md.push('')
  }
  writeFileSync(join(process.cwd(), 'docs', 'REFERENCE_TOKENS.md'), md.join('\n'))
  console.log('Готово:', Object.keys(measured).length, 'елементів, шрифти:', fonts.join(', '))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
