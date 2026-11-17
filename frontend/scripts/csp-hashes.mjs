// Друкує 'sha256-...' для кожного вбудованого <script> у зібраному index.html (для CSP у deploy/nginx.conf).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const html = readFileSync(process.argv[2] ?? 'dist/index.html', 'utf8')
const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
  (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
)
process.stdout.write(hashes.join(' '))
