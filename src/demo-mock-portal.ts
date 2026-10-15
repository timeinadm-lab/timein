// TEMPORÁRIO — só para tirar os prints do guia do portal. NÃO COMMITAR.
// Simula o banco do portal com uma nutricionista fictícia.
const params = new URLSearchParams(location.search)
if (params.get('p')) localStorage.setItem('demo_persona', params.get('p')!)
const persona = localStorage.getItem('demo_persona') || 'consultora'
if (location.pathname.endsWith('portal-demo.html')) history.replaceState(null, '', params.get('ir') || '/portal')

const uid = 'demo-emp-1'
const C1 = 'cli-1', C2 = 'cli-2'
let seq = 100
const novoId = () => 'demo-' + (++seq)

const linkConsult = {
  id: 'lnk-1', employee_id: uid, client_id: C1, client: { id: C1, name: 'Restaurante Sabor & Cia' },
  service_type: 'Consultoria', pay_mode: 'mensal', agenda_mode: 'colaborador', visit_frequency: 'Semanal',
  weekly_hours_quota: 4, visits_per_week: 1, monthly_hours_quota: 16, start_date: '2026-09-01', contract_end_date: null,
  link_units: [{ unit_id: 'u1', unit_name: 'Unidade Centro', visit_rate: 180 }, { unit_id: 'u2', unit_name: 'Unidade Paulista', visit_rate: 180 }],
  payment_dates: [], is_temporary: false,
}
const linkFixo = {
  id: 'lnk-2', employee_id: uid, client_id: C2, client: { id: C2, name: 'Hospital Bem-Estar' },
  service_type: 'Fixo', pay_mode: 'mensal', work_schedule_type: '5x2', days_off: [0, 6], daily_hours: 8,
  work_start: '08:00', work_end: '17:00', break_minutes: 60, monthly_amount: 3500, start_date: '2026-09-01',
  contract_end_date: null, is_temporary: false,
}
const linkRh = { ...linkConsult, agenda_mode: 'gestor' }
const link12 = { ...linkFixo, work_schedule_type: '12x36', days_off: null, schedule_anchor_date: '2026-10-02', daily_hours: 12, work_start: '07:00', work_end: '19:00' }
const link61 = { ...linkFixo, work_schedule_type: '6x1', days_off: [0] }
const ehFixo = persona === 'fixo' || persona === 'plantao' || persona === 'seisum'
const state = {
  links: persona === 'fixo' ? [linkFixo] : persona === 'plantao' ? [link12] : persona === 'seisum' ? [link61] : persona === 'rh' ? [linkRh] : [linkConsult],
  units: ehFixo ? [] : [
    { id: 'u1', client_id: C1, name: 'Unidade Centro', visit_rate: 180 },
    { id: 'u2', client_id: C1, name: 'Unidade Paulista', visit_rate: 180 },
  ],
  notices: [] as Record<string, unknown>[],
  questions: [
    { id: 'q1', employee_id: uid, message: 'Oi! Posso trocar a visita de terça para quarta?', created_at: '2026-09-29T10:12:00-03:00', answer: 'Pode sim! É só usar o botão Trocar na agenda.', answered_at: '2026-09-29T10:40:00-03:00', answered_by: 'RH', initiated_by_admin: false },
  ] as Record<string, unknown>[],
  agenda: ehFixo ? [] as Record<string, unknown>[] : persona === 'rh' ? [
    { id: 'a1', employee_id: uid, client_id: C1, unit_id: 'u1', planned_date: '2026-10-01', planned_time: '09:00', created_by_admin: true, client: { name: 'Restaurante Sabor & Cia' }, unit: { name: 'Unidade Centro' } },
    { id: 'a2', employee_id: uid, client_id: C1, unit_id: 'u2', planned_date: '2026-10-07', planned_time: '14:00', created_by_admin: true, client: { name: 'Restaurante Sabor & Cia' }, unit: { name: 'Unidade Paulista' } },
    { id: 'a3', employee_id: uid, client_id: C1, unit_id: 'u1', planned_date: '2026-10-14', planned_time: '09:00', created_by_admin: true, client: { name: 'Restaurante Sabor & Cia' }, unit: { name: 'Unidade Centro' } },
    { id: 'a4', employee_id: uid, client_id: C1, unit_id: 'u2', planned_date: '2026-10-21', planned_time: '14:00', created_by_admin: true, client: { name: 'Restaurante Sabor & Cia' }, unit: { name: 'Unidade Paulista' } },
    { id: 'a5', employee_id: uid, client_id: C1, unit_id: 'u1', planned_date: '2026-10-28', planned_time: '09:00', created_by_admin: true, client: { name: 'Restaurante Sabor & Cia' }, unit: { name: 'Unidade Centro' } },
  ] as Record<string, unknown>[] : [
    { id: 'a1', employee_id: uid, client_id: C1, unit_id: 'u1', planned_date: '2026-10-01', notes: 'Unidade Centro', client: { name: 'Restaurante Sabor & Cia' }, unit: { name: 'Unidade Centro' } },
    { id: 'a2', employee_id: uid, client_id: C1, unit_id: 'u2', planned_date: '2026-10-08', notes: 'Unidade Paulista', client: { name: 'Restaurante Sabor & Cia' }, unit: { name: 'Unidade Paulista' } },
    { id: 'a3', employee_id: uid, client_id: C1, unit_id: 'u1', planned_date: '2026-10-15', notes: 'Unidade Centro', client: { name: 'Restaurante Sabor & Cia' }, unit: { name: 'Unidade Centro' } },
    { id: 'a4', employee_id: uid, client_id: C1, unit_id: 'u2', planned_date: '2026-10-22', notes: 'Unidade Paulista', client: { name: 'Restaurante Sabor & Cia' }, unit: { name: 'Unidade Paulista' } },
  ] as Record<string, unknown>[],
  visits: (ehFixo ? [
    { id: 'v1', employee_id: uid, client_id: C2, visit_date: '2026-10-01', check_in: '08:00:00', check_out: '17:00:00', break_start: null, break_end: null, client: { name: 'Hospital Bem-Estar' }, created_at: '2026-10-01T17:05:00-03:00' },
  ] : [
    { id: 'v1', employee_id: uid, client_id: C1, unit_id: 'u1', visit_date: '2026-10-01', check_in: '09:00:00', check_out: '13:00:00', visit_rate: 180, report_url: 'relatorios/demo/r1.pdf', client: { name: 'Restaurante Sabor & Cia' }, created_at: '2026-10-01T13:10:00-03:00' },
  ]) as Record<string, unknown>[],
  expenses: [
    { id: 'e1', employee_id: uid, description: 'Uber até o cliente', amount: 38.5, category: 'Reembolso', status: 'pendente', reference_month: '2026-10', receipt_url: 'receipts/demo/e1.jpg', created_at: '2026-10-01T14:00:00-03:00', client_id: ehFixo ? C2 : C1 },
  ] as Record<string, unknown>[],
}
const nomeCli = (id: unknown) => (id === C1 ? 'Restaurante Sabor & Cia' : 'Hospital Bem-Estar')
const unidade = (id: unknown) => state.units.find(u => u.id === id)

type Args = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const rpcs: Record<string, (a: Args) => unknown> = {
  portal_login: () => ({ token: 'demo-token', employee_id: uid, full_name: persona === 'fixo' ? 'Carla Demonstração' : persona === 'plantao' ? 'Paula Demonstração' : persona === 'rh' ? 'Renata Demonstração' : 'Mariana Demonstração' }),
  portal_logout: () => null,
  portal_base: () => ({ links: state.links, units: state.units, notices: state.notices, questions: [...state.questions].reverse(), agenda: state.agenda.filter(a => String(a.planned_date) >= '2026-10-02') }),
  portal_month: a => ({
    visits: state.visits.filter(v => String(v.visit_date).startsWith(a.p_month)),
    expenses: state.expenses.filter(e => e.reference_month === a.p_month),
  }),
  portal_agenda: a => state.agenda.filter(x => String(x.planned_date).startsWith(a.p_month)),
  portal_save_visit: a => {
    const p = a.p_payload
    const id = p.id || novoId()
    const old = state.visits.find(v => v.id === id)
    const u = unidade(p.unit_id)
    const reg = { ...(old || {}), ...p, id, employee_id: uid, client: { name: nomeCli(p.client_id) }, check_in: p.check_in ? p.check_in + ':00' : null, check_out: p.check_out ? p.check_out + ':00' : null, visit_rate: u ? u.visit_rate : null, created_at: new Date().toISOString() }
    if (old) Object.assign(old, reg); else state.visits.push(reg)
    return id
  },
  portal_set_visit_file: a => { const v = state.visits.find(x => x.id === a.p_id); if (v) v[a.p_field] = a.p_url; return null },
  portal_delete_visit: a => { state.visits = state.visits.filter(v => v.id !== a.p_id); return null },
  portal_save_agenda: a => {
    const p = a.p_payload; const id = p.id || novoId()
    state.agenda.push({ ...p, id, employee_id: uid, client: { name: nomeCli(p.client_id) }, unit: unidade(p.unit_id) ? { name: unidade(p.unit_id)!.name } : null })
    return id
  },
  portal_delete_agenda: a => { state.agenda = state.agenda.filter(x => x.id !== a.p_id); return null },
  portal_reschedule_agenda: a => { const x = state.agenda.find(y => y.id === a.p_id); if (x) { x.original_date = x.planned_date; x.planned_date = a.p_new_date } return null },
  portal_trocar_visita: a => { const x = state.agenda.find(y => y.id === a.p_id); if (x) { x.original_date = x.planned_date; x.planned_date = a.p_nova_data } return null },
  portal_trocar_dia_agenda: () => null,
  portal_save_notice: a => { state.notices.push({ ...a.p_payload, id: novoId(), employee_id: uid }); return null },
  portal_delete_notice: a => { state.notices = state.notices.filter(n => n.id !== a.p_id); return null },
  portal_add_expense: a => { const id = novoId(); state.expenses.unshift({ ...a.p_payload, id, employee_id: uid, status: 'pendente', created_at: new Date().toISOString() }); return id },
  portal_set_expense_receipt: a => { const e = state.expenses.find(x => x.id === a.p_id); if (e) e.receipt_url = a.p_url; return null },
  portal_ask_question: a => { state.questions.push({ id: novoId(), employee_id: uid, message: a.p_message, created_at: new Date().toISOString(), answer: null }); return null },
  portal_trocar_senha: () => null,
  // Aba Qualidade (checklists)
  portal_qualidade: () => ({
    modelos: [{ id: 'm1', nome: 'Checklist MELI', perguntas: 126 }],
    auditorias: audDemo.map(a => ({ ...a, total: itensDemo.length, respondidas: itensDemo.filter(i => i.resposta).length })),
  }),
  portal_auditoria_criar: () => 'aud-1',
  portal_auditoria_abrir: () => ({ auditoria: audDemo[0], itens: itensDemo }),
  portal_auditoria_responder: a => { const it = itensDemo.find(i => i.id === a.p_item); if (it) Object.assign(it, a.p_payload); return null },
  portal_auditoria_salvar: () => null,
  portal_auditoria_finalizar: () => 72,
  portal_auditoria_excluir: () => null,
}
const faixasDemo = [{ min: 90, rotulo: 'Excelente' }, { min: 75, rotulo: 'Bom' }, { min: 60, rotulo: 'Regular' }, { min: 0, rotulo: 'Inadequado' }]
const audDemo = [
  { id: 'aud-1', titulo: 'Checklist MELI', data: '2026-10-06', status: 'rascunho', nota: null, faixas: faixasDemo, cliente: 'Restaurante Sabor & Cia', unidade: 'Unidade Centro', concessionaria: null, auditor_nome: 'Mariana Demonstração', inicio: '09:00:00', fim: null, observacoes: null },
  { id: 'aud-2', titulo: 'Checklist MELI', data: '2026-09-22', status: 'finalizada', nota: 84, faixas: faixasDemo, cliente: 'Restaurante Sabor & Cia', unidade: 'Unidade Paulista', concessionaria: null, auditor_nome: 'Mariana Demonstração', inicio: '09:00:00', fim: '11:30:00', observacoes: null },
]
const perguntaDemo = (n: number, secao: string, texto: string, grupo: string, resposta: string | null, extra: Record<string, unknown> = {}) =>
  ({ id: 'it' + n, grupo, secao, texto, peso: grupo === 'Boas Práticas' ? 2 : 1, ordem: n, resposta, observacao: null, fotos: [] as string[], foto_obrigatoria: false, ...extra })
const itensDemo = [
  perguntaDemo(1, 'Edificação e Instalações', 'Área externa do estabelecimento está livre de objetos em desuso ou estranhos ao ambiente?', 'Boas Práticas', 'C'),
  perguntaDemo(2, 'Edificação e Instalações', 'Pisos em adequado estado de conservação, livre de trincas, rachaduras, infiltrações e outros?', 'Estrutura', 'NC', { observacao: 'Piso avariado no estoque.', fotos: ['auditorias/aud-1/a.jpg'] }),
  perguntaDemo(3, 'Edificação e Instalações', 'Tetos de revestimento liso, impermeável e lavável?', 'Estrutura', null),
  perguntaDemo(4, 'Processo', 'O fluxo do pré-preparo evita o cruzamento entre alimentos crus, higienizados e prontos para consumo? (Observação do fluxo e fotografia da área)', 'Boas Práticas', null, { foto_obrigatoria: true }),
  perguntaDemo(5, 'Processo', 'As bancadas são higienizadas entre diferentes atividades e tipos de alimentos? (Observação da troca de processo e fotografia do processo)', 'Boas Práticas', 'C', { foto_obrigatoria: true }),
]

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
const original = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!/supabase\.co/.test(url)) return original(input, init)
  const m = url.match(/\/rest\/v1\/rpc\/([a-z_]+)/)
  if (m) {
    const fn = rpcs[m[1]]
    let args: Args = {}
    try { args = JSON.parse(String(init?.body || '{}')) } catch { /* sem corpo */ }
    await new Promise(r => setTimeout(r, 120))
    return json(fn ? fn(args) : null)
  }
  if (/\/storage\/v1\/object\/sign\//.test(url)) return json({ signedURL: '/favicon.svg' })
  if (/\/storage\/v1\/object\//.test(url)) return json({ Key: 'arquivos/demo', Id: 'demo' })
  return json([])
}
export {}
