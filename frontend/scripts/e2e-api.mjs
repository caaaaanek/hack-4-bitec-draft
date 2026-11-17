/**
 * Наскрізна перевірка фронтенду з бекендом у браузері (після `docker compose up --build`).
 *
 *   cd frontend && npx playwright install chromium   # один раз
 *   node scripts/e2e-api.mjs --base http://localhost:8080 --password "$DEMO_PASSWORD"
 *
 * Проходить ролі: керівник (усі екрани результатів, рішення щодо рекомендації), адміністратор (хвиля за
 * посиланнями, видача посилань), анонімне проходження за посиланням і повтор (409), респондент за обліковим
 * записом, робоча група (чек-лист, файл-доказ), укладач (підтвердження), аудитор (журнал, вихід).
 * Створює в БД демо-хвилі «E2E …»: запускайте на демо-стенді з чистою базою (docker compose down -v).
 * Знімки екранів: artifacts/e2e/. Свій Chrome: CHROME=/шлях/до/chrome.
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

const BASE = arg('base') ?? process.env.BASE ?? 'http://localhost:8080'
const PASS = arg('password') ?? process.env.DEMO_PASSWORD
if (!PASS) {
  console.error('Вкажіть пароль демо-користувачів: --password "$DEMO_PASSWORD"')
  process.exit(2)
}
const shots = 'artifacts/e2e'
mkdirSync(shots, { recursive: true })
const errors = []
const log = (...a) => console.log(...a)
let ok = 0,
  fail = 0
const check = (name, cond, info = '') => {
  if (cond) {
    ok++
    log('  ok  ', name)
  } else {
    fail++
    log('FAIL  ', name, info)
  }
}

const browser = await chromium.launch(
  process.env.CHROME ? { executablePath: process.env.CHROME } : {},
)
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'uk-UA' })
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${page.url()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`))
  return { ctx, page }
}
async function login(page, user) {
  await page.goto(`${BASE}/login`)
  await page.getByLabel('Логін').fill(user)
  await page.getByLabel('Пароль').fill(PASS)
  await page.getByRole('button', { name: 'Увійти' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 })
  await page.waitForSelector('[data-ready="true"]')
}
async function visit(page, path, name) {
  await page.goto(`${BASE}${path}`)
  await page.waitForSelector('main [data-ready="true"], [data-ready="true"]', { timeout: 15000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false })
  const text = await page
    .locator('main')
    .innerText()
    .catch(() => '')
  return text
}

// 1. Керівник
{
  const { ctx, page } = await newPage()
  await page.goto(`${BASE}/`)
  await page.waitForURL(/\/login/)
  await page.screenshot({ path: `${shots}/00-login.png` })
  check('без входу → сторінка входу', page.url().includes('/login'))
  await login(page, 'leader')
  const home = await visit(page, '/', '01-home')
  check('огляд: індекс з бекенду (53,7)', home.includes('53,7'), home.slice(0, 300))
  check('огляд: без помилки', !home.includes('Не вдалося'))
  for (const [p, n, needle] of [
    ['/explain', '02-explain', 'Підзвітність'],
    ['/compare', '03-compare', 'Культура'],
    ['/trends', '04-trends', '2026'],
    ['/recommendations', '05-recs', 'Підзвітність'],
    ['/tracker', '06-tracker', 'Уповноважена'],
    ['/reports', '07-report', '53,7'],
    ['/integrations', '08-integrations', ''],
  ]) {
    const t = await visit(page, p, n)
    check(
      `${p}: дані`,
      t.includes(needle) && !t.includes('Не вдалося завантажити'),
      t.slice(0, 200),
    )
  }
  // Рішення: прийняти першу запропоновану рекомендацію
  await page.goto(`${BASE}/recommendations`)
  await page.getByText('Нові рекомендації').waitFor()
  const acceptBtn = page.getByRole('button', { name: /^Прийняти/ }).first()
  if (await acceptBtn.count()) {
    await acceptBtn.click()
    await page.getByRole('button', { name: 'Прийняти й створити захід' }).click()
    await page.waitForTimeout(1200)
    const t = await page.locator('main').innerText()
    check('рекомендацію прийнято на сервері', t.includes('Подивитися захід у трекері'))
    await page.screenshot({ path: `${shots}/09-accepted.png` })
  } else check('є кнопка «Прийняти»', false)
  const tr = await visit(page, '/tracker', '10-tracker-after')
  check('трекер: 6 заходів після прийняття', /6 заходів/.test(tr), tr.slice(0, 300))
  await ctx.close()
}

// 2. Адміністратор: хвиля за посиланнями
let links
{
  const { ctx, page } = await newPage()
  await login(page, 'admin')
  check('admin → керування циклом', page.url().endsWith('/manage'))
  await page.screenshot({ path: `${shots}/11-manage.png` })
  await page.getByRole('button', { name: 'Нова хвиля' }).click()
  await page.getByLabel('Назва хвилі').fill('E2E анонімна')
  await page.getByText('Анонімно за одноразовими посиланнями').click()
  await page.screenshot({ path: `${shots}/12-new-wave.png`, fullPage: true })
  await page.getByRole('button', { name: 'Створити чернетку' }).click()
  await page.getByRole('button', { name: 'Відкрити хвилю' }).click()
  await page.getByRole('button', { name: 'Відкрити', exact: true }).click()
  await page.waitForTimeout(1000)
  const unit = page.getByLabel('Підрозділ', { exact: true })
  const opts = await unit.locator('option').allInnerTexts()
  const a = opts.find((o) => o.includes('Підрозділ А'))
  if (a) await unit.selectOption({ label: a })
  await page.getByLabel('Кількість').fill('6')
  await page.getByRole('button', { name: 'Видати' }).click()
  await page.waitForTimeout(1000)
  links = await page.locator('ol a').evaluateAll((els) => els.map((e) => e.href))
  check('видано 6 посилань', links.length === 6, String(links.length))
  await page.screenshot({ path: `${shots}/13-links.png`, fullPage: true })
  await ctx.close()
}

// 3. Анонімне проходження
async function answerAll(page) {
  await page.getByRole('button', { name: 'Розумію, почати' }).click()
  for (let i = 0; i < 12; i++) {
    const radios = page.locator('fieldset')
    const n = await radios.count()
    for (let j = 0; j < n; j++) {
      const opts = radios.nth(j).locator('input[type=radio]')
      if (await opts.count())
        await opts.nth(Math.min(2, (await opts.count()) - 1)).check({ force: true })
    }
    const send = page.getByRole('button', { name: 'Надіслати' })
    if (await send.count()) {
      await send.click()
      break
    }
    await page.getByRole('button', { name: 'Далі' }).click()
  }
  await page.waitForTimeout(1200)
}
if (links?.length) {
  const { ctx, page } = await newPage()
  await page.goto(links[0])
  await page.waitForSelector('[data-ready="true"]')
  await page.screenshot({ path: `${shots}/14-token-start.png` })
  await answerAll(page)
  const t = await page.locator('body').innerText()
  check(
    'анонімне подання прийнято',
    t.includes('Ваші відповіді збережено анонімно'),
    t.slice(0, 300),
  )
  await page.screenshot({ path: `${shots}/15-token-thanks.png` })
  await page.goto(links[0])
  await page.waitForTimeout(1200)
  const again = await page.locator('body').innerText()
  check('повтор посилання → «вже заповнено»', again.includes('вже заповнено'), again.slice(0, 200))
  await page.screenshot({ path: `${shots}/16-token-used.png` })
  await page.goto(`${BASE}/s/not-a-real-token-123`)
  await page.waitForTimeout(1000)
  check('недійсне посилання', (await page.locator('body').innerText()).includes('недійсне'))
  await ctx.close()
}

// 4. Хвиля за обліковими записами + чек-лист
{
  const { ctx, page } = await newPage()
  await login(page, 'admin')
  await page.getByRole('button', { name: 'Нова хвиля' }).click()
  await page.getByLabel('Назва хвилі').fill('E2E за обліковими записами')
  await page.getByRole('button', { name: 'Створити чернетку' }).click()
  await page.getByRole('button', { name: 'Відкрити хвилю' }).click()
  await page.getByRole('button', { name: 'Відкрити', exact: true }).click()
  await page.waitForTimeout(1000)
  check(
    'хвилю відкрито',
    (await page.locator('main').innerText()).includes('Закрити й порахувати індекс'),
  )
  await page.screenshot({ path: `${shots}/17-open-wave.png` })
  await ctx.close()
}
{
  const { ctx, page } = await newPage()
  await login(page, 'staff01')
  check('staff01 → мої анкети', page.url().endsWith('/me'))
  await page.screenshot({ path: `${shots}/18-me.png`, fullPage: true })
  const go = page.getByRole('link', { name: 'Пройти анкету' }).first()
  check('є анкета до проходження', (await go.count()) > 0)
  if (await go.count()) {
    await go.click()
    await page.waitForSelector('[data-ready="true"]')
    await answerAll(page)
    check(
      'подання за обліковим записом',
      (await page.locator('body').innerText()).includes('збережено анонімно'),
    )
    await page.goto(`${BASE}/me`)
    await page.waitForTimeout(1000)
    check(
      'анкета позначена «Пройдено»',
      (await page.locator('main').innerText()).includes('Пройдено'),
    )
  }
  await ctx.close()
}
{
  const { ctx, page } = await newPage()
  await login(page, 'wg1')
  const t = await visit(page, '/checklist', '19-checklist-wg')
  check('чек-лист для робочої групи', t.includes('Пунктів'), t.slice(0, 200))
  const first = page
    .locator('main li')
    .filter({ has: page.getByRole('button', { name: 'Додати файл' }) })
    .first()
  await first.getByLabel('Статус').selectOption('full')
  await first.getByLabel(/Доказ/).fill('Наказ № 12 від 01.11.2026 (синтетичний)')
  await first.getByRole('button', { name: 'Зберегти' }).click()
  await page.waitForTimeout(800)
  await first.locator('input[type=file]').setInputFiles({
    name: 'nakaz.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% e2e\n%%EOF\n'),
  })
  await page.waitForTimeout(1500)
  const after = await page.locator('main').innerText()
  check(
    'файл-доказ додано з sha256',
    after.includes('nakaz.pdf') && after.includes('sha256'),
    after.slice(0, 300),
  )
  await page.screenshot({ path: `${shots}/20-checklist-file.png` })
  await ctx.close()
}
{
  const { ctx, page } = await newPage()
  await login(page, 'commissioner')
  const t = await visit(page, '/checklist', '21-checklist-commissioner')
  const btn = page.getByRole('button', { name: 'Підтвердити за доказами' }).first()
  check('укладач бачить «Підтвердити»', (await btn.count()) > 0, t.slice(0, 200))
  if (await btn.count()) {
    await btn.click()
    await page.waitForTimeout(1000)
    check(
      'пункт підтверджено',
      (await page.getByRole('button', { name: 'Відкликати підтвердження' }).count()) > 0,
    )
  }
  const s = await visit(page, '/surveys', '22-surveys')
  check('анкети укладача', s.includes('Опубліковано'))
  await ctx.close()
}
{
  const { ctx, page } = await newPage()
  await login(page, 'auditor')
  const t = await visit(page, '/audit', '23-audit')
  await page.getByRole('button', { name: 'Перевірити ланцюжок' }).click()
  await page.waitForTimeout(1500)
  check(
    'журнал цілий',
    (await page.locator('main').innerText()).includes('Ланцюжок цілий'),
    t.slice(0, 200),
  )
  await page.screenshot({ path: `${shots}/24-audit-verified.png` })
  await page.getByRole('button', { name: /Обліковий запис/ }).click()
  await page.getByRole('button', { name: 'Вийти' }).click()
  await page.waitForURL(/\/login/)
  check('вихід', page.url().includes('/login'))
  await ctx.close()
}
// 5. Мобільний огляд
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await login(page, 'leader')
  await page.screenshot({ path: `${shots}/25-mobile-home.png`, fullPage: true })
  await ctx.close()
}
await browser.close()
log(`\nok ${ok}, fail ${fail}`)
if (errors.length) {
  log('\nПомилки консолі:')
  for (const e of [...new Set(errors)].slice(0, 30)) log('  ', e)
}
process.exit(fail ? 1 : 0)
