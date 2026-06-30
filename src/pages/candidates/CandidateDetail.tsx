import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Edit, MessageCircle, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatWhatsApp, PIPELINE_COLORS } from '../../lib/utils'
import toast from 'react-hot-toast'

export default function CandidateDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showContactForm, setShowContactForm] = useState(false)
  const [contact, setContact] = useState({ contact_date: new Date().toISOString().slice(0, 10), responsible: '', observations: '' })
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

  const { data: contacts } = useQuery({
    queryKey: ['candidate-contacts', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('candidate_contacts').select('*').eq('candidate_id', id).order('created_at', { ascending: false })
      if (error) throw error
      return data || []
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

  const addContact = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('candidate_contacts').insert({ candidate_id: id, ...contact })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Contato registrado!')
      qc.invalidateQueries({ queryKey: ['candidate-contacts', id] })
      setShowContactForm(false)
      setContact({ contact_date: new Date().toISOString().slice(0, 10), responsible: '', observations: '' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!candidate) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" /></div>

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button onClick={() => navigate(-1)} className="btn-ghost px-2 -ml-2 text-sm"><ArrowLeft size={16} />Voltar</button>

      <div className="card p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-display font-extrabold text-lg flex-shrink-0">
              {candidate.full_name.split(' ').map((n: string) => n[0]).slice(0, 2).join('')}
            </div>
            <div className="min-w-0">
              <h1 className="text-xl md:text-2xl font-display font-extrabold text-ink-900 truncate">{candidate.full_name}</h1>
              <div className="flex gap-1.5 flex-wrap mt-1.5">
                <span className={`badge ${PIPELINE_COLORS[candidate.pipeline_stage] || 'bg-ink-100 text-ink-600'}`}>{candidate.pipeline_stage}</span>
                {candidate.state && <span className="badge bg-ink-100 text-ink-600">{candidate.city}, {candidate.state}</span>}
                {candidate.formation && <span className="badge bg-blue-50 text-blue-600">{candidate.formation}</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {candidate.whatsapp && (
              <button onClick={() => { setWAMessage(''); setShowWAModal(true) }} className="btn-secondary text-sm">
                <MessageCircle size={16} className="text-green-600" /> <span className="hidden sm:inline">WhatsApp</span>
              </button>
            )}
            <button onClick={() => navigate(`/candidatos/${id}/editar`)} className="btn-secondary text-sm"><Edit size={16} /><span className="hidden sm:inline">Editar</span></button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-5 space-y-3 text-sm">
          <h3 className="font-medium text-gray-900">Dados Pessoais</h3>
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-xs text-gray-400">WhatsApp</span><p>{candidate.whatsapp || '-'}</p></div>
            <div><span className="text-xs text-gray-400">E-mail</span><p className="truncate">{candidate.email || '-'}</p></div>
            <div><span className="text-xs text-gray-400">CRN</span><p>{candidate.crn_number ? `${candidate.crn_number}/${candidate.crn_region}` : '-'}</p></div>
            <div><span className="text-xs text-gray-400">Veículo</span><p>{candidate.has_vehicle ? 'Sim' : 'Não'}</p></div>
            <div><span className="text-xs text-gray-400">Viagens</span><p>{candidate.requires_travel ? 'Aceita' : 'Não'}</p></div>
            <div><span className="text-xs text-gray-400">Mudança</span><p>{candidate.requires_relocation ? 'Aceita' : 'Não'}</p></div>
          </div>
        </div>

        <div className="card p-5 space-y-3 text-sm">
          <h3 className="font-medium text-gray-900">Formação</h3>
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-xs text-gray-400">Formação</span><p>{candidate.formation || '-'}</p></div>
            <div><span className="text-xs text-gray-400">Experiência</span><p>{candidate.experience_time || '-'}</p></div>
            <div><span className="text-xs text-gray-400">Instituição</span><p>{candidate.institution || '-'}</p></div>
            <div><span className="text-xs text-gray-400">Vol. Máx.</span><p>{candidate.max_meals_volume || '-'}</p></div>
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

      {/* Vacancy history */}
      {vacancyHistory && vacancyHistory.length > 0 && (
        <div className="card p-5 space-y-3">
          <h3 className="font-medium">Processos Seletivos</h3>
          <div className="space-y-2">
            {vacancyHistory.map(vi => (
              <div key={vi.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100">
                <div>
                  <p className="text-sm font-medium cursor-pointer hover:text-primary-600" onClick={() => navigate(`/vagas/${(vi as { vacancy?: { id: string } }).vacancy?.id}`)}>
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

      {/* Contacts */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Histórico de Contatos</h3>
          <button onClick={() => setShowContactForm(true)} className="btn-secondary text-sm flex items-center gap-1"><Plus size={14} />Registrar</button>
        </div>
        {showContactForm && (
          <div className="bg-gray-50 p-4 rounded-lg space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Data</label><input className="input" type="date" value={contact.contact_date} onChange={e => setContact(p => ({ ...p, contact_date: e.target.value }))} /></div>
              <div><label className="label">Responsável</label><input className="input" value={contact.responsible} onChange={e => setContact(p => ({ ...p, responsible: e.target.value }))} /></div>
              <div className="col-span-2"><label className="label">Observação</label><textarea className="input" rows={2} value={contact.observations} onChange={e => setContact(p => ({ ...p, observations: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2">
              <button className="btn-primary text-sm" onClick={() => addContact.mutate()}>Salvar</button>
              <button className="btn-secondary text-sm" onClick={() => setShowContactForm(false)}>Cancelar</button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          {contacts?.map(c => (
            <div key={c.id} className="p-3 rounded-lg border border-gray-100">
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">{formatDate(c.contact_date)}</span>
                {c.responsible && <span className="text-xs text-gray-500">{c.responsible}</span>}
              </div>
              {c.observations && <p className="text-sm mt-1">{c.observations}</p>}
            </div>
          ))}
          {contacts?.length === 0 && <p className="text-sm text-gray-400">Nenhum contato registrado</p>}
        </div>
      </div>

      {/* WhatsApp modal */}
      {showWAModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 space-y-4">
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
