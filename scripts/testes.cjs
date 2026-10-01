// Roda os testes das regras de negócio (src/**/*.test.ts) — pagamento, jornada.
// Uso: npm run testes
// Cada teste é empacotado com o esbuild (que já vem com o Vite) e roda no Node.
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')
const { buildSync } = require('esbuild')

const raiz = path.join(__dirname, '..')
const achar = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name)
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : achar(p)
  return e.name.endsWith('.test.ts') ? [p] : []
})

const testes = achar(path.join(raiz, 'src'))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'testes-'))
let falhou = 0
for (const t of testes) {
  console.log(`\n▶ ${path.relative(raiz, t)}`)
  const saida = path.join(tmp, path.basename(t, '.ts') + '.cjs')
  buildSync({ entryPoints: [t], bundle: true, platform: 'node', format: 'cjs', outfile: saida, logLevel: 'error', external: ['xlsx', 'jspdf'],
    // Algumas regras importam o cliente do banco: endereço falso, nunca é chamado no teste
    define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'http://teste.invalid', VITE_SUPABASE_ANON_KEY: 'teste', DEV: false }) } })
  try { execFileSync(process.execPath, [saida], { stdio: 'inherit' }) } catch { falhou++ }
}
fs.rmSync(tmp, { recursive: true, force: true })
console.log(falhou ? `\n✖ ${falhou} arquivo(s) de teste com falha` : `\n✓ ${testes.length} arquivo(s) de teste, tudo certo`)
process.exit(falhou ? 1 : 0)
