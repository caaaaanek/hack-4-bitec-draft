// Playwright використовується скриптом scripts/verify.ts напряму; конфіг лише фіксує браузер.
import { defineConfig } from 'playwright/test'
export default defineConfig({ use: { browserName: 'chromium' } })
