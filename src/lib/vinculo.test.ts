// Regra de vínculo encerrado e a contagem do sino. Rodar: npm run testes
import { vinculoEncerrado, vinculoAtivo, diasAteFim, contaVinculosSemContrato, pendenciaDeContrato, podeAcessarPortal, CARENCIA_ACESSO_PORTAL_DIAS } from './vinculo'
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

// Carência do portal: contrato que acaba no dia 11 ainda abre a folha no dia 12
// e some no dia 13. Encerrado continua sendo a partir do dia seguinte ao fim.
ok(CARENCIA_ACESSO_PORTAL_DIAS === 1, 'carência do portal é 1 dia')
const fim11 = { contract_end_date: '2026-11-11' }
ok(podeAcessarPortal(fim11, '2026-11-10'), 'fim dia 11: acessa no dia 10')
ok(podeAcessarPortal(fim11, '2026-11-11'), 'fim dia 11: acessa no dia 11')
ok(podeAcessarPortal(fim11, '2026-11-12'), 'fim dia 11: acessa no dia 12')
ok(!podeAcessarPortal(fim11, '2026-11-13'), 'fim dia 11: não acessa no dia 13')
ok(!vinculoEncerrado(fim11, '2026-11-11'), 'fim dia 11: no próprio dia o vínculo não está encerrado')
ok(vinculoEncerrado(fim11, '2026-11-12'), 'fim dia 11: no dia 12 já está encerrado (a carência não muda isso)')
ok(vinculoEncerrado(fim11, '2026-11-13'), 'fim dia 11: no dia 13 continua encerrado')
ok(podeAcessarPortal({ contract_end_date: '2026-11-11T23:00:00Z' }, '2026-11-12'), 'carência ignora a hora e usa só o dia')
ok(podeAcessarPortal({ contract_end_date: null }, '2026-11-13'), 'sem data de fim: segue no portal')
ok(podeAcessarPortal({}, '2026-11-13'), 'sem fim e sem registro: segue no portal')
ok(!podeAcessarPortal(null, '2026-11-11'), 'sem vínculo: não acessa')
ok(podeAcessarPortal({ contract_end_date: '2026-11-11', ended_at: '2026-11-01T12:00:00Z' }, '2026-11-12'), 'registro antecipado do RH não tira o dia de carência')
ok(podeAcessarPortal({ ended_at: '2026-11-01T12:00:00Z' }, '2026-11-13'), 'ended_at sem data de fim não esconde a folha')
ok(podeAcessarPortal({ contract_end_date: '2026-01-31' }, '2026-01-31'), 'fim 31/01: acessa no dia 31')
ok(podeAcessarPortal({ contract_end_date: '2026-01-31' }, '2026-02-01'), 'fim 31/01: acessa em 01/02')
ok(!podeAcessarPortal({ contract_end_date: '2026-01-31' }, '2026-02-02'), 'fim 31/01: não acessa em 02/02')
ok(podeAcessarPortal({ contract_end_date: '2026-12-31' }, '2027-01-01'), 'fim 31/12: acessa em 01/01')
ok(!podeAcessarPortal({ contract_end_date: '2026-12-31' }, '2027-01-02'), 'fim 31/12: não acessa em 02/01')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) falharam`)
