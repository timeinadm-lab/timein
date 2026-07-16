import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Edit, Plus, Trash2, Upload, FileText, ExternalLink, Building2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { SignedLink } from '../../components/ui/SignedFile'
import DeletePinModal from '../../components/ui/DeletePinModal'
import { SkeletonDetail } from '../../components/ui/Skeleton'
import { formatDate, formatCurrency } from '../../lib/utils'
import { differenceInDays, parseISO } from 'date-fns'
import toast from 'react-hot-toast'

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  // Clientes: recrutador tem os mesmos direitos do chefe (só pagamentos são exclusivos do chefe)
  const canManageClient = true
  const qc = useQueryClient()
  const [tab, setTab] = useState<'dados' | 'contratos' | 'colaboradores' | 'vistorias' | 'unidades' | 'documentos'>('contratos')
  const [docForm, setDocForm] = useState({ topic: '', name: '' })
  const [docFile, setDocFile] = useState<File | null>(null)
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [confirmDeleteClient, setConfirmDeleteClient] = useState(false)

  const deleteClient = useMutation({
    mutationFn: async () => {
      // Trava de segurança: não apaga cliente com vínculo ou vaga ativos
      const { data: linksData } = await supabase.from('employee_client_links').select('id').eq('client_id', id).limit(1)
      if (linksData?.length) throw new Error('Este cliente tem colaboradores vinculados. Desligue-os antes de excluir.')
      const { data: vagasData } = await supabase.from('vacancies').select('id').eq('client_id', id).limit(1)
      if (vagasData?.length) throw new Error('Este cliente tem vagas. Apague as vagas antes de excluir o cliente.')
      // Remove dependentes diretos e o cliente
      await supabase.from('client_units').delete().eq('client_id', id)
      await supabase.from('client_locations').delete().eq('client_id', id)
      await supabase.from('client_contracts').delete().eq('client_id', id)
      await supabase.from('shared_documents').delete().eq('client_id', id)
      const { error } = await supabase.from('clients').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Cliente excluído.')
      qc.invalidateQueries({ queryKey: ['clients'] })
      navigate('/clientes')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [newLoc, setNewLoc] = useState({ name: '', hourly_rate: '' })
  const [showLocForm, setShowLocForm] = useState(false)
  const [newUnit, setNewUnit] = useState({ name: '', visit_rate: '', service_type: 'Consultoria' })
  const [showUnitForm, setShowUnitForm] = useState(false)
  const [showContractForm, setShowContractForm] = useState(false)
  const [newContract, setNewContract] = useState({ title: '', contract_number: '', start_date: '', end_date: '', monthly_value: '', status: 'Vigente', notes: '' })

  const { data: client } = useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*,supervisor:user_profiles(full_name)').eq('id', id).single()
      if (error) throw error
      return data
    },
  })

  const { data: locations } = useQuery({
    queryKey: ['client-locations', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_locations').select('*').eq('client_id', id).order('name')
      if (error) throw error
      return data || []
    },
  })

  const { data: links } = useQuery({
    queryKey: ['client-employee-links', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_client_links')
        .select('*,employee:employees(id,full_name,role),payment_dates:employee_payment_dates(day_of_month,amount)')
        .eq('client_id', id)
      if (error) throw error
      return data || []
    },
  })

  const { data: inspections } = useQuery({
    queryKey: ['client-inspections', id],
    queryFn: async () => {
      const links2 = await supabase.from('inspection_links').select('id').eq('client_id', id)
      if (!links2.data?.length) return []
      const ids = links2.data.map(l => l.id)
      const { data, error } = await supabase.from('inspections').select('*,location:client_locations(name)').in('link_id', ids).order('check_in', { ascending: false }).limit(20)
      if (error) throw error
      return data || []
    },
  })

  // ── Documentos compartilhados (anexados aqui ou nas vagas deste cliente) ──
  const { data: sharedDocs } = useQuery({
    queryKey: ['client-shared-docs', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shared_documents')
        .select('*, vacancy:vacancies(title)')
        .eq('client_id', id)
        .order('topic').order('created_at')
      if (error) throw error
      return data || []
    },
    enabled: tab === 'documentos',
  })

  const uploadClientDoc = async () => {
    if (!docFile || !docForm.name.trim()) { toast.error('Informe o nome e escolha o arquivo'); return }
    setUploadingDoc(true)
    try {
      const ext = docFile.name.split('.').pop()
      const { data: inserted, error } = await supabase.from('shared_documents').insert({
        client_id: id,
        topic: docForm.topic.trim() || 'Geral',
        name: docForm.name.trim(),
      }).select('id').single()
      if (error) throw error
      const path = `shared/${id}/${inserted.id}.${ext}`
      const { error: upErr } = await supabase.storage.from('arquivos').upload(path, docFile, { upsert: true })
      if (upErr) throw upErr
      await supabase.from('shared_documents').update({ file_url: path }).eq('id', inserted.id)
      toast.success('Documento anexado!')
      qc.invalidateQueries({ queryKey: ['client-shared-docs', id] })
      setDocForm({ topic: docForm.topic, name: '' })
      setDocFile(null)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUploadingDoc(false)
    }
  }

  const deleteSharedDoc = useMutation({
    mutationFn: async (docId: string) => {
      const { error } = await supabase.from('shared_documents').delete().eq('id', docId)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Documento removido.'); qc.invalidateQueries({ queryKey: ['client-shared-docs', id] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const addLocation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('client_locations').insert({
        client_id: id,
        name: newLoc.name,
        hourly_rate: newLoc.hourly_rate ? Number(newLoc.hourly_rate) : null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Local adicionado!')
      qc.invalidateQueries({ queryKey: ['client-locations', id] })
      setNewLoc({ name: '', hourly_rate: '' })
      setShowLocForm(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteLocation = useMutation({
    mutationFn: async (locId: string) => {
      const { error } = await supabase.from('client_locations').delete().eq('id', locId)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Local removido!'); qc.invalidateQueries({ queryKey: ['client-locations', id] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const { data: contracts } = useQuery({
    queryKey: ['client-contracts', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_contracts').select('*').eq('client_id', id).order('start_date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const addContract = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('client_contracts').insert({
        client_id: id,
        title: newContract.title,
        contract_number: newContract.contract_number || null,
        start_date: newContract.start_date || null,
        end_date: newContract.end_date || null,
        monthly_value: newContract.monthly_value ? Number(newContract.monthly_value) : null,
        status: newContract.status,
        notes: newContract.notes || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Contrato adicionado!')
      qc.invalidateQueries({ queryKey: ['client-contracts', id] })
      setNewContract({ title: '', contract_number: '', start_date: '', end_date: '', monthly_value: '', status: 'Vigente', notes: '' })
      setShowContractForm(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteContract = useMutation({
    mutationFn: async (contractId: string) => {
      const { error } = await supabase.from('client_contracts').delete().eq('id', contractId)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Contrato removido!'); qc.invalidateQueries({ queryKey: ['client-contracts', id] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const uploadContractFile = async (contractId: string, file: File) => {
    setUploadingId(contractId)
    try {
      const path = `clients/${id}/${contractId}_${Date.now()}.pdf`
      const { error: upErr } = await supabase.storage.from('arquivos').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { error: updErr } = await supabase.from('client_contracts').update({ file_url: path }).eq('id', contractId)
      if (updErr) throw updErr
      toast.success('Arquivo anexado!')
      qc.invalidateQueries({ queryKey: ['client-contracts', id] })
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setUploadingId(null)
    }
  }

  const { data: units } = useQuery({
    queryKey: ['client-units', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_units').select('*').eq('client_id', id).order('name')
      if (error) throw error
      return data || []
    },
  })

  const addUnit = useMutation({
    mutationFn: async () => {
      // Unidade é só um local. Tipo (Fixo/Consultoria) e valor são definidos na vaga.
      const { error } = await supabase.from('client_units').insert({
        client_id: id,
        name: newUnit.name,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Unidade adicionada!')
      qc.invalidateQueries({ queryKey: ['client-units', id] })
      setNewUnit({ name: '', visit_rate: '', service_type: 'Consultoria' })
      setShowUnitForm(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteUnit = useMutation({
    mutationFn: async (unitId: string) => {
      const { error } = await supabase.from('client_units').delete().eq('id', unitId)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Unidade removida!'); qc.invalidateQueries({ queryKey: ['client-units', id] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!client) return <SkeletonDetail />

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <button onClick={() => navigate(-1)} className="btn-ghost px-2 -ml-2 text-sm"><ArrowLeft size={16} />Voltar</button>

      {/* Hero do cliente */}
      <div className="card p-4 md:p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary-50 flex items-center justify-center flex-shrink-0">
          <Building2 size={26} className="text-primary-600" />
        </div>
        <h1 className="text-xl md:text-2xl font-display font-extrabold text-ink-900 flex-1 min-w-0 truncate">{client.name}</h1>
        {canManageClient && (
          <div className="flex gap-2 shrink-0">
            <button onClick={() => navigate(`/clientes/${id}/editar`)} className="btn-secondary text-sm">
              <Edit size={16} /> <span className="hidden sm:inline">Editar</span>
            </button>
            <button onClick={() => setConfirmDeleteClient(true)} className="btn-secondary text-sm text-red-600 hover:bg-red-50 border-red-200">
              <Trash2 size={16} /> <span className="hidden sm:inline">Excluir</span>
            </button>
          </div>
        )}
      </div>

      <DeletePinModal
        open={confirmDeleteClient}
        title="Excluir cliente?"
        description={`Remove ${client.name} e seus dados (unidades, contratos, documentos). Só é possível se não houver colaboradores nem vagas.`}
        confirmLabel="Excluir cliente"
        onConfirmed={() => deleteClient.mutateAsync()}
        onClose={() => setConfirmDeleteClient(false)}
      />

      {/* Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {(['contratos', 'dados', 'unidades', 'colaboradores', 'vistorias', 'documentos'] as const).map(t => (
          <button key={t} onClick={() => setTab(t as typeof tab)}
            className={`px-3.5 py-2 text-sm font-semibold whitespace-nowrap rounded-xl transition-all active:scale-95 ${tab === t ? 'bg-primary-600 text-white shadow-soft' : 'bg-white border border-ink-100 text-ink-500 hover:text-ink-800 hover:border-ink-200'}`}>
            {t === 'unidades' ? 'Unidades' : t === 'contratos' ? 'Contratos' : t === 'documentos' ? 'Documentos' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* DOCUMENTOS — banco compartilhado: anexados aqui ou vindos das vagas */}
      {tab === 'documentos' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div>
              <h3 className="font-semibold text-sm">Anexar documento</h3>
              <p className="text-xs text-gray-400">Crie o tópico na hora (ex: Colaboradores, Contratos, Fotos 3x4). Documentos anexados nas vagas deste cliente também aparecem aqui.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">Tópico</label>
                <input className="input text-sm" placeholder="Ex: Colaboradores" list="client-doc-topics" value={docForm.topic} onChange={e => setDocForm(p => ({ ...p, topic: e.target.value }))} />
                <datalist id="client-doc-topics">
                  {[...new Set((sharedDocs || []).map(d => d.topic))].map(t => <option key={t} value={t} />)}
                  <option value="Contratos" /><option value="Colaboradores" /><option value="Fotos 3x4" />
                </datalist>
              </div>
              <div>
                <label className="label text-xs">Nome do documento *</label>
                <input className="input text-sm" placeholder="Ex: Contrato assinado – Maria" value={docForm.name} onChange={e => setDocForm(p => ({ ...p, name: e.target.value }))} />
              </div>
            </div>
            <input id="client-doc-file" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="hidden"
              onChange={e => setDocFile(e.target.files?.[0] || null)} />
            <button
              type="button"
              onClick={() => document.getElementById('client-doc-file')?.click()}
              className="w-full border-2 border-dashed border-gray-300 rounded-xl px-4 py-3 text-sm text-gray-500 hover:border-primary-400 hover:text-primary-600 transition-colors text-center"
            >
              {docFile ? `✓ ${docFile.name}` : '+ Escolher arquivo (PDF ou foto)'}
            </button>
            <button className="btn-primary text-sm w-full" disabled={uploadingDoc || !docFile || !docForm.name.trim()} onClick={uploadClientDoc}>
              {uploadingDoc ? 'Enviando...' : 'Anexar documento'}
            </button>
          </div>

          {(!sharedDocs || sharedDocs.length === 0) && (
            <div className="card p-8 text-center text-gray-400 text-sm">
              <FileText size={28} className="mx-auto mb-2 opacity-40" />
              Nenhum documento neste cliente ainda.
            </div>
          )}
          {[...new Set((sharedDocs || []).map(d => d.topic))].map(topic => (
            <div key={topic} className="card overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">{topic}</div>
              <div className="divide-y divide-gray-50">
                {(sharedDocs || []).filter(d => d.topic === topic).map(d => (
                  <div key={d.id} className="px-4 py-3 flex items-center gap-3">
                    <FileText size={16} className="text-gray-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{d.name}</p>
                      <p className="text-xs text-gray-400">
                        {formatDate(d.created_at)}
                        {(d as { vacancy?: { title?: string } }).vacancy?.title ? ` · via vaga: ${(d as { vacancy?: { title?: string } }).vacancy!.title}` : ''}
                      </p>
                    </div>
                    {d.file_url && <SignedLink value={d.file_url} bucket="arquivos" className="text-xs text-primary-600 underline">abrir</SignedLink>}
                    <button className="text-gray-300 hover:text-red-500 p-1" onClick={() => { if (window.confirm(`Excluir "${d.name}"?`)) deleteSharedDoc.mutate(d.id) }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'contratos' && (
        <div className="space-y-4">
          {/* Contrato principal (do cadastro do cliente) */}
          {(client.contract_start || client.contract_end || !client.contract_end) && (() => {
            const daysLeft = client.contract_end ? differenceInDays(parseISO(client.contract_end), new Date()) : null
            const expired = daysLeft !== null && daysLeft < 0
            const expiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 40
            const isIndeterminate = !client.contract_end
            return (
              <div className={`card p-4 border-l-4 ${isIndeterminate ? 'border-gray-400' : expired ? 'border-red-500' : expiringSoon ? 'border-amber-400' : 'border-green-500'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-gray-900">Contrato Principal</p>
                      <span className={`badge text-xs ${isIndeterminate ? 'bg-gray-100 text-gray-600' : expired ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{isIndeterminate ? 'Indeterminado' : expired ? 'Encerrado' : 'Vigente'}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      {client.contract_start && <span>Início: {formatDate(client.contract_start)}</span>}
                      {client.contract_end ? <span>Vencimento: {formatDate(client.contract_end)}</span> : <span>Sem data de vencimento</span>}
                    </div>
                    {daysLeft !== null && (
                      <div className={`mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${expired ? 'bg-red-100 text-red-700' : expiringSoon ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                        {expired ? `Vencido há ${Math.abs(daysLeft)} dias` : daysLeft === 0 ? 'Vence hoje!' : `Faltam ${daysLeft} dias`}
                      </div>
                    )}
                  </div>
                  <button onClick={() => navigate(`/clientes/${id}/editar`)} className="btn-secondary text-xs shrink-0">
                    <Edit size={12} /> Editar datas
                  </button>
                </div>
              </div>
            )
          })()}

          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Contratos Adicionais</h3>
            {canManageClient && (
              <button onClick={() => setShowContractForm(true)} className="btn-secondary text-xs flex items-center gap-1">
                <Plus size={12} /> Novo Contrato
              </button>
            )}
          </div>

          {showContractForm && (
            <div className="card p-4 space-y-3 border border-primary-200">
              <h4 className="text-sm font-medium text-gray-700">Novo Contrato</h4>
              <div className="grid grid-cols-2 gap-3">
                <input className="input col-span-2" placeholder="Título / descrição" value={newContract.title} onChange={e => setNewContract(p => ({ ...p, title: e.target.value }))} />
                <input className="input" placeholder="Número do contrato" value={newContract.contract_number} onChange={e => setNewContract(p => ({ ...p, contract_number: e.target.value }))} />
                <input className="input" placeholder="Valor mensal R$" type="number" value={newContract.monthly_value} onChange={e => setNewContract(p => ({ ...p, monthly_value: e.target.value }))} />
                <div><label className="label text-xs">Início</label><input className="input" type="date" value={newContract.start_date} onChange={e => setNewContract(p => ({ ...p, start_date: e.target.value }))} /></div>
                <div><label className="label text-xs">Vencimento</label><input className="input" type="date" value={newContract.end_date} onChange={e => setNewContract(p => ({ ...p, end_date: e.target.value }))} /></div>
                <select className="input" value={newContract.status} onChange={e => setNewContract(p => ({ ...p, status: e.target.value }))}>
                  <option>Vigente</option><option>Encerrado</option><option>Suspenso</option>
                </select>
                <input className="input" placeholder="Observações" value={newContract.notes} onChange={e => setNewContract(p => ({ ...p, notes: e.target.value }))} />
              </div>
              <div className="flex gap-2 justify-end">
                <button className="btn-secondary text-sm" onClick={() => setShowContractForm(false)}>Cancelar</button>
                <button className="btn-primary text-sm" onClick={() => addContract.mutate()} disabled={!newContract.title || addContract.isPending}>Salvar</button>
              </div>
            </div>
          )}

          <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" className="hidden"
            onChange={async e => {
              const file = e.target.files?.[0]
              if (!file || !uploadingId) return
              await uploadContractFile(uploadingId, file)
              e.target.value = ''
            }}
          />

          {contracts?.length === 0 && !showContractForm && (
            <p className="text-sm text-gray-400 text-center py-6">Nenhum contrato cadastrado</p>
          )}

          <div className="space-y-3">
            {contracts?.map(c => {
              const daysLeft = c.end_date ? differenceInDays(parseISO(c.end_date), new Date()) : null
              const expiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 40
              const expired = daysLeft !== null && daysLeft < 0
              return (
                <div key={c.id} className={`card p-4 border-l-4 ${expired ? 'border-red-500' : expiringSoon ? 'border-amber-400' : 'border-green-500'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-900">{c.title}</p>
                        {c.contract_number && <span className="badge bg-gray-100 text-gray-600 text-xs">#{c.contract_number}</span>}
                        <span className={`badge text-xs ${c.status === 'Vigente' ? 'bg-green-100 text-green-700' : c.status === 'Encerrado' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-700'}`}>{c.status}</span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                        {c.start_date && <span>Início: {formatDate(c.start_date)}</span>}
                        {c.end_date && <span>Vence: {formatDate(c.end_date)}</span>}
                        {c.monthly_value && <span className="font-medium text-gray-700">{formatCurrency(c.monthly_value)}/mês</span>}
                      </div>
                      {c.end_date && (
                        <div className={`mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${expired ? 'bg-red-100 text-red-700' : expiringSoon ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                          {expired ? `Vencido há ${Math.abs(daysLeft!)} dias` : daysLeft === 0 ? 'Vence hoje!' : `Faltam ${daysLeft} dias`}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {c.file_url ? (
                        <SignedLink value={c.file_url} bucket="arquivos" className="btn-secondary text-xs flex items-center gap-1 py-1 px-2">
                          <ExternalLink size={12} /> Ver PDF
                        </SignedLink>
                      ) : null}
                      {canManageClient && (
                        <button onClick={() => { setUploadingId(c.id); setTimeout(() => fileInputRef.current?.click(), 50) }}
                          className={`btn-secondary text-xs flex items-center gap-1 py-1 px-2 ${uploadingId === c.id ? 'opacity-50' : ''}`}
                          disabled={uploadingId === c.id}>
                          <Upload size={12} /> {uploadingId === c.id ? 'Enviando...' : c.file_url ? 'Trocar PDF' : 'Anexar PDF'}
                        </button>
                      )}
                      {canManageClient && (
                        <button onClick={() => deleteContract.mutate(c.id)} className="text-red-400 hover:text-red-600 p-1">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  {c.notes && <p className="text-xs text-gray-400 mt-2">{c.notes}</p>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'dados' && (
        <div className="space-y-4">
          <div className="card p-5 grid grid-cols-2 gap-4">
            <div><p className="text-xs text-gray-400">CNPJ</p><p className="text-sm">{client.cnpj || '-'}</p></div>
            <div><p className="text-xs text-gray-400">Endereço</p><p className="text-sm">{client.address || '-'}</p></div>
            <div><p className="text-xs text-gray-400">Contato</p><p className="text-sm">{client.contact_name || '-'}</p></div>
            <div><p className="text-xs text-gray-400">Telefone</p><p className="text-sm">{client.contact_phone || '-'}</p></div>
            <div><p className="text-xs text-gray-400">E-mail</p><p className="text-sm">{client.contact_email || '-'}</p></div>
            <div><p className="text-xs text-gray-400">Início contrato</p><p className="text-sm">{formatDate(client.contract_start)}</p></div>
            <div><p className="text-xs text-gray-400">Fim contrato</p><p className="text-sm">{client.contract_end ? formatDate(client.contract_end) : 'Indeterminado'}</p></div>
            <div><p className="text-xs text-gray-400">Posições</p><p className="text-sm">{client.positions_count || '-'}</p></div>
            <div><p className="text-xs text-gray-400">Supervisor</p><p className="text-sm">{client.supervisor?.full_name || '-'}</p></div>
            <div><p className="text-xs text-gray-400">Visitas/mês</p><p className="text-sm">{client.supervision_visits_per_month || '-'}</p></div>
            {client.observations && <div className="col-span-2"><p className="text-xs text-gray-400">Observações</p><p className="text-sm">{client.observations}</p></div>}
          </div>

          {/* Locations */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">Locais de Vistoria</h3>
              {canManageClient && (
                <button onClick={() => setShowLocForm(true)} className="btn-secondary text-xs flex items-center gap-1">
                  <Plus size={12} /> Adicionar Local
                </button>
              )}
            </div>
            {showLocForm && (
              <div className="flex gap-2 mb-3">
                <input className="input flex-1" placeholder="Nome do local" value={newLoc.name} onChange={e => setNewLoc(p => ({ ...p, name: e.target.value }))} />
                <input className="input w-32" placeholder="R$/hora" type="number" value={newLoc.hourly_rate} onChange={e => setNewLoc(p => ({ ...p, hourly_rate: e.target.value }))} />
                <button className="btn-primary" onClick={() => addLocation.mutate()} disabled={!newLoc.name}>Salvar</button>
                <button className="btn-secondary" onClick={() => setShowLocForm(false)}>×</button>
              </div>
            )}
            <div className="space-y-1">
              {locations?.map(l => (
                <div key={l.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50">
                  <span className="text-sm">{l.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">{l.hourly_rate ? formatCurrency(l.hourly_rate) + '/h' : '-'}</span>
                    {canManageClient && (
                      <button onClick={() => deleteLocation.mutate(l.id)} className="text-red-400 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {!locations?.length && <p className="text-sm text-gray-400">Nenhum local cadastrado</p>}
            </div>
          </div>
        </div>
      )}

      {tab === 'unidades' && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Unidades do Cliente</h3>
              <p className="text-xs text-gray-400 mt-0.5">Locais onde o cliente opera. O tipo (Fixo/Consultoria) e o valor são definidos ao abrir a vaga.</p>
            </div>
            {canManageClient && (
              <button onClick={() => setShowUnitForm(true)} className="btn-secondary text-xs flex items-center gap-1">
                <Plus size={12} /> Adicionar Unidade
              </button>
            )}
          </div>
          {showUnitForm && (
            <div className="flex gap-2 mb-4 p-3 bg-gray-50 rounded-xl flex-wrap">
              <input className="input flex-1 min-w-48" placeholder="Nome da unidade (ex: Unidade Centro)" value={newUnit.name} onChange={e => setNewUnit(p => ({ ...p, name: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && newUnit.name) addUnit.mutate() }} />
              <button className="btn-primary shrink-0" onClick={() => addUnit.mutate()} disabled={!newUnit.name || addUnit.isPending}>Salvar</button>
              <button className="btn-secondary shrink-0" onClick={() => setShowUnitForm(false)}>×</button>
            </div>
          )}
          <div className="space-y-2">
            {units?.map(u => (
              <div key={u.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50">
                <p className="text-sm font-medium">{u.name}</p>
                {canManageClient && (
                  <button onClick={() => deleteUnit.mutate(u.id)} className="text-red-400 hover:text-red-600">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
            {!units?.length && (
              <p className="text-sm text-gray-400">Nenhuma unidade cadastrada.</p>
            )}
          </div>
          {units && units.length > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-100 text-sm">
              <span className="text-gray-500">{units.length} unidade{units.length !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      )}

      {tab === 'colaboradores' && (
        <div className="card p-5">
          <h3 className="font-medium mb-4">Colaboradores Vinculados</h3>
          {links?.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhum colaborador vinculado</p>
          ) : (
            <div className="space-y-3">
              {links?.map(l => {
                const emp = (l as { employee?: { id: string; full_name: string; role?: string } }).employee
                const isFixo = l.service_type !== 'Consultoria'
                const payDates = ((l as { payment_dates?: { day_of_month: number; amount: number }[] }).payment_dates || []).sort((a, b) => a.day_of_month - b.day_of_month)
                const contractEnd = (l as { contract_end_date?: string }).contract_end_date
                const daysToEnd = contractEnd ? Math.round((new Date(contractEnd).getTime() - Date.now()) / 86400000) : null
                const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
                const daysOff = ((l as { days_off?: number[] }).days_off || []).map((d: number) => WEEKDAYS[d]).join(', ')

                return (
                  <div key={l.id} className={`rounded-xl border p-4 space-y-3 ${isFixo ? 'border-blue-200 bg-blue-50/30' : 'border-orange-200 bg-orange-50/30'}`}>
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <button
                          className="font-semibold text-sm text-gray-900 hover:text-primary-600 hover:underline text-left"
                          onClick={() => emp?.id && navigate(`/colaboradores/${emp.id}`)}
                        >
                          {emp?.full_name || '—'}
                        </button>
                        {emp?.role && <p className="text-xs text-gray-500">{emp.role}</p>}
                      </div>
                      <span className={`badge flex-shrink-0 ${isFixo ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{l.service_type}</span>
                    </div>

                    {/* Grid de informações */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      {l.start_date && (
                        <>
                          <span className="text-gray-500">Início</span>
                          <span className="font-medium">{formatDate(l.start_date)}</span>
                        </>
                      )}
                      {l.monthly_amount != null && (
                        <>
                          <span className="text-gray-500">Salário mensal</span>
                          <span className="font-medium">{formatCurrency(l.monthly_amount)}</span>
                        </>
                      )}
                      {l.weekly_hours_quota && (
                        <>
                          <span className="text-gray-500">Horas/semana</span>
                          <span className="font-medium">{l.weekly_hours_quota}h</span>
                        </>
                      )}
                      {isFixo && (l as { work_schedule_type?: string }).work_schedule_type && (
                        <>
                          <span className="text-gray-500">Escala</span>
                          <span className="font-medium">{(l as { work_schedule_type?: string }).work_schedule_type}{daysOff ? ` — folga: ${daysOff}` : ''}</span>
                        </>
                      )}
                      {payDates.length > 0 && (
                        <>
                          <span className="text-gray-500">Pagamento</span>
                          <span className="font-medium">{payDates.map(d => `dia ${d.day_of_month}`).join(' e ')}</span>
                        </>
                      )}
                      {contractEnd && (
                        <>
                          <span className="text-gray-500">Vencimento</span>
                          <span className={`font-medium flex items-center gap-1 ${daysToEnd !== null && daysToEnd <= 30 ? 'text-red-600' : daysToEnd !== null && daysToEnd <= 60 ? 'text-amber-600' : ''}`}>
                            {formatDate(contractEnd)}
                            {daysToEnd !== null && daysToEnd >= 0 && <span className="text-gray-400">({daysToEnd}d restantes)</span>}
                            {daysToEnd !== null && daysToEnd < 0 && <span className="text-red-500">(vencido)</span>}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'vistorias' && (
        <div className="card p-5">
          <h3 className="font-medium mb-3">Histórico de Vistorias</h3>
          {inspections?.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhuma vistoria registrada</p>
          ) : (
            <>
              {/* Mobile: cards */}
              <div className="md:hidden space-y-2">
                {inspections?.map(i => (
                  <div key={i.id} className="rounded-xl border border-ink-100 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink-900">{formatDate(i.check_in)}</p>
                      <p className="text-sm font-semibold text-primary-700 tnum">{formatCurrency(i.amount)}</p>
                    </div>
                    <p className="text-xs text-ink-500 mt-0.5">{(i as { location?: { name: string } }).location?.name || 'Local não informado'}</p>
                    <p className="text-xs text-ink-400 mt-1 tnum">
                      {formatDate(i.check_in, 'HH:mm')} → {formatDate(i.check_out, 'HH:mm')} · {i.hours_worked}h
                    </p>
                  </div>
                ))}
              </div>
              {/* Desktop: tabela */}
              <table className="w-full text-sm hidden md:table">
                <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2">Data</th><th>Local</th><th>Entrada</th><th>Saída</th><th>Horas</th><th>Valor</th></tr></thead>
                <tbody>
                  {inspections?.map(i => (
                    <tr key={i.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2">{formatDate(i.check_in)}</td>
                      <td>{(i as { location?: { name: string } }).location?.name || '-'}</td>
                      <td>{formatDate(i.check_in, 'HH:mm')}</td>
                      <td>{formatDate(i.check_out, 'HH:mm')}</td>
                      <td>{i.hours_worked}h</td>
                      <td>{formatCurrency(i.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  )
}
