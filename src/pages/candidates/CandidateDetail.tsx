import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowLeft, Edit, MessageCircle, UserCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatWhatsApp, getInitials, PIPELINE_COLORS, hojeISO } from '../../lib/utils'
import { SkeletonDetail } from '../../components/ui/Skeleton'
import NotasCandidato from './NotasCandidato'

export default function CandidateDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [showWAModal, setShowWAModal] = useState(false)
  const [waMessage, setWAMessage] = useState('')

  const { data: candidate } = useQuery({
    queryKey: ['candidate', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('candidates').select('*').eq('id', id).single()
      if (error) throw error
      return data
    },
  })

  const { data: vacancyHistory } = useQuery({
    queryKey: ['candidate-vacancies', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vacancy_interests')
        .select('*,vacancy:vacancies(id,title,city,state,status)')
        .eq('candidate_id', id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // ── Contratar: o candidato vira colaborador aqui mesmo (19/11/2026) ─────────
  // A aba Vagas saiu ("a gente não tá usando") e era só por ela que alguém virava
  // colaborador. Agora é um botão na ficha: cria a PESSOA com os dados do
  // formulário e abre a ficha dela já no "+ Vincular" — valores, escala e dias de
  // pagamento continuam sendo combinados só lá, como antes.
  const qc = useQueryClient()
  const [contratando, setContratando] = useState(false)
  const [contrato, setContrato] = useState({ cpf: '', admissao: hojeISO() })
  const soNumeros = (s?: string | null) => String(s || '').replace(/\D/g, '')

  // Colaborador que já veio deste candidato (para não cadastrar duas vezes)
  const { data: jaColaborador } = useQuery({
    queryKey: ['candidate-employee', id],
    enabled: !!candidate,
    queryFn: async () => {
      const porOrigem = await supabase.from('employees').select('id,full_name,status').eq('candidate_id', id!).limit(1).maybeSingle()
      if (porOrigem.data) return porOrigem.data as { id: string; full_name: string; status: string }
      // Contratado antes desta mudança (pela vaga): acha pelo interesse contratado
      const { data: vi } = await supabase.from('vacancy_interests').select('employee_id').eq('candidate_id', id!).not('employee_id', 'is', null).limit(1).maybeSingle()
      const empId = (vi as { employee_id?: string } | null)?.employee_id
      if (!empId) return null
      const { data } = await supabase.from('employees').select('id,full_name,status').eq('id', empId).maybeSingle()
      return (data || null) as { id: string; full_name: string; status: string } | null
    },
  })

  const contratar = useMutation({
    mutationFn: async () => {
      const cpf = soNumeros(contrato.cpf)
      if (cpf && cpf.length !== 11) throw new Error('O CPF precisa ter 11 números (ou deixe em branco para preencher depois).')
      if (cpf) {
        const { data: mesmoCpf } = await supabase.from('employees').select('id,full_name').eq('cpf', cpf).limit(1).maybeSingle()
        if (mesmoCpf) throw new Error(`Já existe colaborador com este CPF: ${mesmoCpf.full_name}. Abra a ficha dele em Colaboradores.`)
      }
      const base = {
        full_name: candidate.full_name, cpf: cpf || null,
        whatsapp: candidate.whatsapp || null, phone: candidate.whatsapp || null, email: candidate.email || null,
        crn_number: candidate.crn_number || null, crn_region: candidate.crn_region || null,
        role: candidate.formation || null, address_city: candidate.city || null,
        status: 'Ativo', admission_date: contrato.admissao || hojeISO(),
      }
      // candidate_id é da migração 110: sem ela, cadastra do mesmo jeito
      let r = await supabase.from('employees').insert({ ...base, candidate_id: id }).select('id').single()
      if (r.error && /candidate_id/.test(r.error.message)) r = await supabase.from('employees').insert(base).select('id').single()
      if (r.error) throw new Error(r.error.message)
      const empId = r.data.id as string
      // Senha do portal: a padrão, quando existe (054); senão uma própria, mostrada uma vez
      let senha: string | null = null
      const { data: tipoSenha } = await supabase.rpc('portal_tipo_senha', { p_employee: empId })
      if (tipoSenha !== 'padrao') {
        const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        const nova = Array.from(crypto.getRandomValues(new Uint32Array(8)), n => letras[n % letras.length]).join('')
        const { error: pinErr } = await supabase.rpc('portal_set_pin', { p_employee: empId, p_pin: nova })
        senha = pinErr ? null : nova
      }
      await supabase.from('candidates').update({ pipeline_stage: 'Contratado' }).eq('id', id!)
      return { empId, senha, semCpf: !cpf }
    },
    onSuccess: ({ empId, senha, semCpf }) => {
      toast.success(senha ? `Colaborador criado. Portal: CPF + senha ${senha}` : 'Colaborador criado. Portal: CPF + senha padrão.', { duration: 9000 })
      if (semCpf) toast('Sem CPF ela não entra no portal: preencha na ficha.', { duration: 8000 })
      qc.invalidateQueries({ queryKey: ['candidate', id] })
      qc.invalidateQueries({ queryKey: ['candidate-employee', id] })
      qc.invalidateQueries({ queryKey: ['candidates'] })
      qc.invalidateQueries({ queryKey: ['employees'] })
      setContratando(false)
      navigate(`/colaboradores/${empId}?abrir=vinculo`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!candidate) return <SkeletonDetail />

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button onClick={() => navigate(-1)} className="btn-ghost px-2 -ml-2 text-sm"><ArrowLeft size={16} />Voltar</button>

      <div className="card p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-display font-bold text-lg flex-shrink-0">
              {getInitials(candidate.full_name)}
            </div>
            <div className="min-w-0">
              <h1 className="page-title-sm truncate">{candidate.full_name}</h1>
              <div className="flex gap-1.5 flex-wrap mt-1.5">
                <span className={`badge ${PIPELINE_COLORS[candidate.pipeline_stage] || 'bg-ink-100 text-ink-600'}`}>{candidate.pipeline_stage}</span>
                {candidate.state && <span className="badge bg-ink-100 text-ink-600">{candidate.city}, {candidate.state}</span>}
                {candidate.formation && <span className="badge bg-blue-50 text-blue-600">{candidate.formation}</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {candidate.whatsapp && (
              <button onClick={() => { setWAMessage(''); setShowWAModal(true) }} className="btn-secondary text-sm">
                <MessageCircle size={16} className="text-green-600" /> <span className="hidden sm:inline">WhatsApp</span>
              </button>
            )}
            <button onClick={() => navigate(`/candidatos/${id}/editar`)} className="btn-secondary text-sm"><Edit size={16} /><span className="hidden sm:inline">Editar</span></button>
            {jaColaborador ? (
              <button onClick={() => navigate(`/colaboradores/${jaColaborador.id}`)} className="btn-secondary text-sm"><UserCheck size={16} />Ver ficha de colaborador</button>
            ) : candidate.pipeline_stage !== 'Inativo' && (
              <button onClick={() => { setContrato({ cpf: '', admissao: hojeISO() }); setContratando(true) }} className="btn-primary text-sm"><UserCheck size={16} />Contratar</button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-5 space-y-3 text-sm">
          <h3 className="font-medium text-gray-900">Dados Pessoais</h3>
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-xs text-gray-400">WhatsApp</span><p>{candidate.whatsapp || '-'}</p></div>
            <div><span className="text-xs text-gray-400">E-mail</span><p className="truncate">{candidate.email || '-'}</p></div>
            {/* Sem região preenchida saía "84826/null" na cara do usuário */}
            <div><span className="text-xs text-gray-400">CRN</span><p>{candidate.crn_number ? [candidate.crn_number, candidate.crn_region].filter(Boolean).join('/') : '-'}</p></div>
            <div><span className="text-xs text-gray-400">Veículo</span><p>{candidate.has_vehicle ? 'Sim' : 'Não'}</p></div>
            <div><span className="text-xs text-gray-400">Viagens</span><p>{candidate.requires_travel ? 'Aceita' : 'Não'}</p></div>
            <div><span className="text-xs text-gray-400">Mudança</span><p>{candidate.requires_relocation ? 'Aceita' : 'Não'}</p></div>
            <div><span className="text-xs text-gray-400">Idade</span><p>{candidate.idade || '-'}</p></div>
            <div><span className="text-xs text-gray-400">Pode começar</span><p>{candidate.available_start || '-'}</p></div>
          </div>
        </div>

        <div className="card p-5 space-y-3 text-sm">
          <h3 className="font-medium text-gray-900">Formação</h3>
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-xs text-gray-400">Formação</span><p>{candidate.formation || '-'}</p></div>
            <div><span className="text-xs text-gray-400">Experiência</span><p>{candidate.experience_time || '-'}</p></div>
            <div><span className="text-xs text-gray-400">Instituição</span><p>{candidate.institution || '-'}</p></div>
            <div><span className="text-xs text-gray-400">Maior volume de refeições</span><p>{candidate.volume_refeicoes || (candidate.max_meals_volume ? `a partir de ${Number(candidate.max_meals_volume).toLocaleString('pt-BR')}` : '-')}</p></div>
          </div>
          {candidate.postgrad_options?.length > 0 && (
            <div>
              <span className="text-xs text-gray-400">Pós-grad.</span>
              <div className="flex flex-wrap gap-1 mt-1">{candidate.postgrad_options.map((p: string) => <span key={p} className="badge bg-purple-50 text-purple-700">{p}</span>)}</div>
            </div>
          )}
          {candidate.tools?.length > 0 && (
            <div>
              <span className="text-xs text-gray-400">Ferramentas</span>
              <div className="flex flex-wrap gap-1 mt-1">{candidate.tools.map((t: string) => <span key={t} className="badge bg-blue-50 text-blue-700">{t}</span>)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Resposta aberta do formulário (18/11/2026): pode ser um texto longo */}
      {candidate.sobre && (
        <div className="card p-5 space-y-2">
          <h3 className="font-medium text-gray-900">Sobre a pessoa e a experiência em UAN</h3>
          <p className="text-sm text-ink-700 whitespace-pre-wrap break-words leading-relaxed max-h-96 overflow-y-auto">{candidate.sobre}</p>
        </div>
      )}

      {/* Vacancy history */}
      {vacancyHistory && vacancyHistory.length > 0 && (
        <div className="card p-5 space-y-3">
          <h3 className="font-medium">Processos seletivos antigos <span className="text-xs font-normal text-ink-400">(da época das vagas)</span></h3>
          <div className="space-y-2">
            {vacancyHistory.map(vi => (
              <div key={vi.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100">
                <div>
                  <p className="text-sm font-medium">
                    {(vi as { vacancy?: { title: string } }).vacancy?.title || 'Vaga removida'}
                  </p>
                  <p className="text-xs text-gray-400">
                    {(vi as { vacancy?: { city: string; state: string } }).vacancy?.city}, {(vi as { vacancy?: { city: string; state: string } }).vacancy?.state}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge text-xs ${vi.status === 'Aprovado' ? 'bg-green-100 text-green-700' : vi.status === 'Reprovado' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                    {vi.status || 'Em avaliação'}
                  </span>
                  <span className={`badge text-xs ${(vi as { vacancy?: { status: string } }).vacancy?.status === 'Aberta' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                    Vaga {(vi as { vacancy?: { status: string } }).vacancy?.status || '-'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <NotasCandidato candidateId={id!} />

      {/* Contratar: vira colaborador e segue para o vínculo */}
      {contratando && (
        <div className="modal-overlay">
          <div className="modal-box max-w-md space-y-4">
            <div>
              <h3 className="font-semibold text-ink-900">Contratar {candidate.full_name}</h3>
              <p className="text-sm text-ink-500 mt-1">Vira colaborador com os dados do formulário (nome, WhatsApp, e-mail, CRN, cidade). Em seguida abre a ficha para você vincular ao cliente e combinar valores.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">CPF</label>
                <input className="input" inputMode="numeric" placeholder="Só números" value={contrato.cpf} onChange={e => setContrato(p => ({ ...p, cpf: e.target.value }))} autoFocus />
                <p className="text-[11px] text-ink-400 mt-1">É o login no portal. Pode preencher depois.</p>
              </div>
              <div>
                <label className="label">Data de início</label>
                <input className="input" type="date" value={contrato.admissao} onChange={e => setContrato(p => ({ ...p, admissao: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3">
              <button className="btn-primary flex-1" disabled={contratar.isPending} onClick={() => contratar.mutate()}>{contratar.isPending ? 'Criando…' : 'Contratar e vincular'}</button>
              <button className="btn-secondary" disabled={contratar.isPending} onClick={() => setContratando(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp modal */}
      {showWAModal && (
        <div className="modal-overlay">
          <div className="modal-box max-w-md space-y-4">
            <h3 className="font-semibold">Mensagem WhatsApp</h3>
            <textarea className="input" rows={5} value={waMessage} onChange={e => setWAMessage(e.target.value)} placeholder={`Olá ${candidate.full_name}, ...`} />
            <div className="flex gap-3">
              <a
                href={formatWhatsApp(candidate.whatsapp) + (waMessage ? `?text=${encodeURIComponent(waMessage)}` : '')}
                target="_blank" rel="noreferrer"
                className="btn-primary flex-1 text-center"
                onClick={() => setShowWAModal(false)}
              >Abrir WhatsApp</a>
              <button className="btn-secondary" onClick={() => setShowWAModal(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
