// Regra de vínculo encerrado e a contagem do sino. Rodar: npm run testes
import { vinculoEncerrado, vinculoAtivo, diasAteFim, contaVinculosSemContrato, pendenciaDeContrato } from './vinculo'
import type { AvisoContrato } from './vinculo'

let falhas = 0
const ok = (cond: boolean, nome: string) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome); falhas++ }
}

const HOJE = '2026-11-12'

ok(!vinculoEncerrado(null, HOJE), 'sem vínculo: não encerrado')
ok(!vinculoEncerrado({}, HOJE), 'sem data e sem registro: segue')
ok(!vinculoEncerrado({ contract_end_date: HOJE }, HOJE), 'fim hoje: ainda ativo hoje')
ok(vinculoAtivo({ contract_end_date: HOJE }, HOJE), 'vinculoAtivo no dia do fim')
ok(vinculoEncerrado({ contract_end_date: '2026-11-11' }, HOJE), 'fim ontem: encerrado')
ok(!vinculoEncerrado({ contract_end_date: '2026-11-13' }, HOJE), 'fim amanhã: ainda ativo')
ok(vinculoEncerrado({ contract_end_date: '2026-11-11T23:00:00Z' }, HOJE), 'data com hora: compara só o dia')
ok(vinculoEncerrado({ ended_at: '2026-11-01T12:00:00Z' }, HOJE), 'encerramento registrado sem data de fim: encerrado')
ok(!vinculoEncerrado({ contract_end_date: '2026-11-20', ended_at: '2026-11-01T12:00:00Z' }, HOJE), 'registro antecipado não encerra antes do último dia')
ok(vinculoEncerrado({ contract_end_date: '2026-11-11', ended_at: null }, HOJE), 'data passada sem ended_at: encerrado')
ok(diasAteFim(HOJE, HOJE) === 0, 'dias até o fim hoje = 0')
ok(diasAteFim('2026-11-11', HOJE) === -1, 'fim ontem = -1')
ok(diasAteFim('2026-11-22', HOJE) === 10, 'fim daqui a 10 dias')
ok(diasAteFim(null, HOJE) === null, 'sem fim: sem conta de dias')

const base = (m: Partial<AvisoContrato> = {}): AvisoContrato => ({
  service_type: 'Fixo',
  contract_required: true,
  contract_file_url: null,
  contract_end_date: null,
  ended_at: null,
  created_at: '2026-09-01',
  employee: { status: 'Ativo' },
  ...m,
})

ok(pendenciaDeContrato(base(), HOJE), 'ativo, sem arquivo, exige contrato: conta')
ok(contaVinculosSemContrato([base()], HOJE) === 1, 'sino conta 1')
ok(!pendenciaDeContrato(base({ contract_end_date: '2026-11-11' }), HOJE), 'fim no passado não conta')
ok(pendenciaDeContrato(base({ contract_end_date: HOJE }), HOJE), 'fim hoje ainda conta (trabalha hoje e está sem contrato)')
ok(!pendenciaDeContrato(base({ contract_end_date: '2026-12-01', ended_at: '2026-11-12T10:00:00Z' }), HOJE), 'ended_at tira do sino mesmo com fim no futuro')
ok(!pendenciaDeContrato(base({ ended_at: '2026-11-12T10:00:00Z' }), HOJE), 'ended_at sem data de fim não conta')
ok(!pendenciaDeContrato(base({ contract_file_url: 'employees/a/b.pdf' }), HOJE), 'com arquivo não conta')
ok(!pendenciaDeContrato(base({ employee: { status: 'Inativo' } }), HOJE), 'colaborador inativo não conta')
ok(!pendenciaDeContrato(base({ employee: [{ status: 'Inativo' }] }), HOJE), 'employee em lista: lê o primeiro')
ok(pendenciaDeContrato(base({ employee: [{ status: 'Ativo' }] }), HOJE), 'employee em lista ativo: conta')
ok(!pendenciaDeContrato(base({ service_type: 'Volante' }), HOJE), 'freela antigo não entra no sino')
ok(!pendenciaDeContrato(base({ contract_required: false, created_at: '2026-09-01' }), HOJE), 'marcado não exige, criado depois de 19/08: não conta')
ok(pendenciaDeContrato(base({ contract_required: false, created_at: '2026-08-01' }), HOJE), 'vínculo antigo sem a opção: continua contando')
ok(pendenciaDeContrato(base({ service_type: 'Consultoria' }), HOJE), 'consultoria conta')

const mistura = [
  base(),
  base({ contract_end_date: '2026-10-01' }),
  base({ ended_at: '2026-11-01T00:00:00Z', contract_end_date: '2026-11-30' }),
  base({ contract_file_url: 'x.pdf' }),
  base({ contract_end_date: HOJE }),
  base({ employee: { status: 'Desligado' } }),
]
ok(contaVinculosSemContrato(mistura, HOJE) === 2, 'na mistura sobram o ativo sem fim e o que termina hoje')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) falharam`)
