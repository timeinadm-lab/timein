// Trava do build: roda o TypeScript de verdade e BLOQUEIA o deploy só nos
// erros que quebram a tela na mão do usuário. O "tsc" do build antigo não
// checava nada (tsconfig.json tem files: []), e foi assim que a ficha do
// colaborador subiu travando.
//
// Os ~80 avisos antigos de tipagem do Supabase (relação vista como lista,
// comparação de tipos) não quebram nada e ficam de fora — senão nenhum
// deploy passaria.
const { spawnSync } = require('child_process')

const QUEBRA_A_TELA = new Set([
  'TS1005', 'TS1109', 'TS1128', 'TS1136', 'TS1161', // sintaxe
  'TS2304', // nome que não existe
  'TS2448', 'TS2454', // variável usada antes de existir
  'TS2551', // método/propriedade que não existe ("did you mean")
  'TS2552', // nome errado ("did you mean")
  'TS2349', // chamando algo que não é função
  'TS2307', // import de arquivo que não existe
  'TS2305', 'TS2724', // import de algo que o arquivo não exporta
  'TS2554', 'TS2555', // número errado de argumentos
])

const r = spawnSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.app.json'], { encoding: 'utf8', shell: true })
const linhas = (r.stdout || '').split('\n').filter(l => / error TS\d+/.test(l))
const graves = linhas.filter(l => QUEBRA_A_TELA.has((l.match(/error (TS\d+)/) || [])[1]))

// ── Trava do horário (05/10/2026): compromisso/reunião é gravado como "hora de
// parede" (cadastrou 11h → banco guarda 11:00 sem fuso). Formatar com new Date()
// ou toLocaleTimeString converte para Brasília e 11h vira 08h. Use
// formatLocalTime / formatLocalDateTime / parseLocal (src/lib/utils.ts).
// Carimbo real (created_at, paid_at…) pode converter: marque a linha com "fuso-ok".
const fs = require('fs'), path = require('path')
const arquivos = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
  const f = path.join(d, e.name)
  return e.isDirectory() ? arquivos(f) : /\.tsx?$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [f] : []
})
const fuso = []
for (const f of arquivos(path.join(__dirname, '..', 'src'))) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
    if (/fuso-ok/.test(l)) return
    const conversao = /toLocaleTimeString\(/.test(l) || (/toLocaleString\(/.test(l) && /hour/.test(l))
    const dataDeCompromisso = /new Date\([^)]*scheduled_at/.test(l) && !/parseLocal\(/.test(l)
    if (conversao || dataDeCompromisso) fuso.push(`${path.relative(path.join(__dirname, '..'), f)}:${i + 1}  ${l.trim().slice(0, 110)}`)
  })
}
if (fuso.length) {
  console.error('\n✖ Horário com fuso errado — deploy bloqueado (11h viraria 08h).')
  console.error('  Use formatLocalTime/parseLocal; se for carimbo real (created_at), marque a linha com // fuso-ok\n')
  for (const l of fuso) console.error('  ' + l)
  console.error('')
  process.exit(1)
}

if (graves.length) {
  console.error('\n✖ Erros que quebram a tela — deploy bloqueado:\n')
  for (const l of graves) console.error('  ' + l)
  console.error('')
  process.exit(1)
}
console.log(`✓ Checagem ok (${linhas.length} aviso(s) antigo(s) de tipagem ignorado(s))`)
