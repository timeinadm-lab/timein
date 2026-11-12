import { useEffect, useMemo, useRef, useState, FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { rotuloDoVinculo, semAcento } from '../../lib/utils'
import {
  MODELO_PADRAO, MODELO_PADRAO_ID, ROTULO_VARIAVEL, chavesRestantes, dadosDoContrato, dataBr,
  nomeArquivoContrato, preencherModelo,
} from '../../lib/contratoDocumento'
import type { ClienteContrato, PessoaContrato, VinculoContrato } from '../../lib/contratoDocumento'
import { baixarBlob, blobDoContrato } from '../../lib/contratoPdf'
import { anexarNoVinculo, enviarPdfContrato } from '../../lib/anexarContrato'
import { vinculoEncerrado } from '../../lib/vinculo'
import toast from 'react-hot-toast'

type Pessoa = PessoaContrato & { id: string; full_name: string; status?: string | null }
type Cliente = ClienteContrato & { id: string }
type LinkRow = VinculoContrato & {
  id: string
  employee_id: string
  client_id: string
  ended_at?: string | null
  contract_file_url?: string | null
  vacancy_id?: string | null
  client?: Cliente | Cliente[] | null
}

const um = <T,>(v: T | T[] | null | undefined): T | null => (v == null ? null : Array.isArray(v) ? (v[0] ?? null) : v)

function traduzErro(msg: string) {
  if (/employee_id|client_id|link_id|content|file_url|schema cache|column/i.test(msg)) {
    return 'Falta rodar a migração 106 no Supabase (contratos ligados ao colaborador e ao cliente).'
  }
  return msg
}

export default function ContractForm() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const vinculoParam = params.get('vinculo')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEdit = !!id

  const [form, setForm] = useState({
    employee_id: '', link_id: '', client_id: '',
    template_id: isEdit ? '' : MODELO_PADRAO_ID,
    start_date: '', end_date: '',
    signed: false, signed_at: '',
    employee_responsible: '',
    requires_supervision: false,
    supervision_visits_per_month: '',
    supervisor_id: '',
    observations: '',
    anexar: true,
  })
  const [conteudo, setConteudo] = useState('')
  const [travado, setTravado] = useState(isEdit)
  const [busca, setBusca] = useState('')
  const carregou = useRef(false)
  const aplicouParam = useRef(false)

  const { data: pessoas } = useQuery({
    queryKey: ['contrato-pessoas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees')
        .select('id,full_name,cpf,rg,role,email,whatsapp,phone,address,address_street,address_number,address_neighborhood,address_city,address_zip,crn_number,crn_region,status')
        .order('full_name')
      if (error) throw error
      return (data || []) as Pessoa[]
    },
  })

  const { data: clientes } = useQuery({
    queryKey: ['contrato-clientes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients')
        .select('id,name,cnpj,address,contact_name,contact_phone,contact_email')
        .order('name')
      if (error) throw error
      return (data || []) as Cliente[]
    },
  })

  const { data: vinculos } = useQuery({
    queryKey: ['contrato-vinculos', form.employee_id],
    enabled: !!form.employee_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_client_links')
        .select('id,employee_id,client_id,service_type,coverage_type,pay_mode,monthly_amount,daily_rate,start_date,contract_end_date,ended_at,contract_file_url,work_schedule_type,work_schedule,work_start,work_end,daily_hours,horas_semana,cost_assistance,cost_assistance_periodo,vacancy_id,link_units,client:clients(id,name,cnpj,address,contact_name,contact_phone,contact_email)')
        .eq('employee_id', form.employee_id)
        .order('start_date', { ascending: false })
      if (error) throw error
      return (data || []) as LinkRow[]
    },
  })

  const { data: templates } = useQuery({
    queryKey: ['contract-templates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contract_templates').select('id,name,content').order('name')
      if (error) throw error
      return data || []
    },
  })

  const { data: supervisors } = useQuery({
    queryKey: ['user-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('id,full_name,role').order('full_name')
      if (error) throw error
      return data || []
    },
  })

  const { data: contractData } = useQuery({
    queryKey: ['contract', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('contracts').select('*').eq('id', id).single()
      if (error) throw error
      return data
    },
    enabled: isEdit,
  })

  useEffect(() => {
    if (!contractData || carregou.current) return
    carregou.current = true
    setForm({
      employee_id: contractData.employee_id || '',
      link_id: contractData.link_id || '',
      client_id: contractData.client_id || '',
      template_id: contractData.template_id || (contractData.content ? '' : MODELO_PADRAO_ID),
      start_date: contractData.start_date || '',
      end_date: contractData.end_date || '',
      signed: !!contractData.signed,
      signed_at: contractData.signed_at || '',
      employee_responsible: contractData.employee_responsible || '',
      requires_supervision: !!contractData.requires_supervision,
      supervision_visits_per_month: contractData.supervision_visits_per_month ? String(contractData.supervision_visits_per_month) : '',
      supervisor_id: contractData.supervisor_id || '',
      observations: contractData.observations || '',
      anexar: false,
    })
    setConteudo(contractData.content || '')
    setTravado(!!contractData.content)
  }, [contractData])

  useEffect(() => {
    if (isEdit || !vinculoParam || aplicouParam.current || !vinculos) return
    const l = vinculos.find(v => v.id === vinculoParam)
    if (!l) return
    aplicouParam.current = true
    setForm(f => ({
      ...f,
      employee_id: l.employee_id,
      link_id: l.id,
      client_id: l.client_id,
      start_date: (l.start_date || '').slice(0, 10),
      end_date: (l.contract_end_date || '').slice(0, 10),
      anexar: !l.contract_file_url,
    }))
    setTravado(false)
  }, [isEdit, vinculoParam, vinculos])

  // O param traz o colaborador antes da lista de vínculos existir
  const { data: vinculoInicial } = useQuery({
    queryKey: ['contrato-vinculo-inicial', vinculoParam],
    enabled: !!vinculoParam && !isEdit,
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_client_links').select('id,employee_id').eq('id', vinculoParam!).maybeSingle()
      if (error) throw error
      return data
    },
  })
  useEffect(() => {
    if (!vinculoInicial || form.employee_id) return
    setForm(f => ({ ...f, employee_id: vinculoInicial.employee_id, link_id: vinculoInicial.id }))
  }, [vinculoInicial, form.employee_id])

  const pessoa = pessoas?.find(p => p.id === form.employee_id) || null
  const link = vinculos?.find(v => v.id === form.link_id) || null
  const clienteDoLink = um(link?.client)
  const cliente = clienteDoLink || clientes?.find(c => c.id === form.client_id) || null

  const modelo = form.template_id === MODELO_PADRAO_ID
    ? MODELO_PADRAO
    : (templates?.find(t => t.id === form.template_id)?.content || '')

  const dados = useMemo(() => dadosDoContrato({
    pessoa, cliente, vinculo: link,
    inicio: form.start_date, fim: form.end_date,
  }), [pessoa, cliente, link, form.start_date, form.end_date])

  const gerado = useMemo(() => preencherModelo(modelo, dados), [modelo, dados])

  useEffect(() => {
    if (travado) return
    setConteudo(gerado.texto)
  }, [gerado.texto, travado])

  const faltando = chavesRestantes(conteudo)
  const pessoasVisiveis = (pessoas || []).filter(p => {
    if (p.status !== 'Ativo' && p.id !== form.employee_id) return false
    if (!busca.trim()) return true
    return semAcento(p.full_name).includes(semAcento(busca.trim()))
  })
  const vinculosOrdenados = [...(vinculos || [])].sort((a, b) => {
    const ea = vinculoEncerrado(a) ? 1 : 0
    const eb = vinculoEncerrado(b) ? 1 : 0
    if (ea !== eb) return ea - eb
    return (um(a.client)?.name || '').localeCompare(um(b.client)?.name || '', 'pt-BR')
  })

  const escolherVinculo = (linkId: string) => {
    if (!linkId) {
      setForm(f => ({ ...f, link_id: '', anexar: false }))
      return
    }
    const l = vinculos?.find(v => v.id === linkId)
    if (!l) return
    setForm(f => ({
      ...f,
      link_id: l.id,
      client_id: l.client_id,
      start_date: (l.start_date || '').slice(0, 10),
      end_date: (l.contract_end_date || '').slice(0, 10),
      anexar: !l.contract_file_url,
    }))
    setTravado(false)
  }

  const nomeClienteAtual = cliente?.name || ''

  const montarPdf = async () => blobDoContrato({
    titulo: 'Contrato de prestação de serviços',
    linha: [pessoa?.full_name, nomeClienteAtual].filter(Boolean).join(' · '),
    corpo: conteudo,
  })

  const baixarPrevia = async () => {
    if (!conteudo.trim()) { toast.error('O texto do contrato está vazio.'); return }
    try {
      const blob = await montarPdf()
      baixarBlob(blob, nomeArquivoContrato(pessoa?.full_name, nomeClienteAtual))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const salvar = useMutation({
    mutationFn: async () => {
      if (isEdit && !carregou.current) throw new Error('Os dados ainda não carregaram. Espere e tente de novo.')
      if (!form.employee_id) throw new Error('Escolha o colaborador.')
      const clientId = link?.client_id || form.client_id
      if (!clientId) throw new Error('Escolha o cliente ou o vínculo.')
      if (!conteudo.trim()) throw new Error('O texto do contrato está vazio.')
      const payload = {
        client_name: nomeClienteAtual || null,
        client_id: clientId,
        employee_id: form.employee_id,
        link_id: form.link_id || null,
        template_id: form.template_id && form.template_id !== MODELO_PADRAO_ID ? form.template_id : null,
        type: form.template_id ? 'Padrão' : 'Manual',
        content: conteudo,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        signed: form.signed,
        signed_at: form.signed ? (form.signed_at || null) : null,
        employee_responsible: form.employee_responsible || null,
        requires_supervision: form.requires_supervision,
        supervision_visits_per_month: form.requires_supervision ? (Number(form.supervision_visits_per_month) || null) : null,
        supervisor_id: form.requires_supervision ? (form.supervisor_id || null) : null,
        observations: form.observations || null,
        updated_at: new Date().toISOString(),
      }
      let contractId = id || ''
      if (isEdit) {
        const { error } = await supabase.from('contracts').update(payload).eq('id', id)
        if (error) throw new Error(traduzErro(error.message))
      } else {
        const { data, error } = await supabase.from('contracts').insert(payload).select('id').single()
        if (error) throw new Error(traduzErro(error.message))
        contractId = data.id
      }
      try {
        const blob = await montarPdf()
        const path = await enviarPdfContrato(form.employee_id, blob, form.link_id || null)
        const { error: upErr } = await supabase.from('contracts').update({ file_url: path }).eq('id', contractId)
        if (upErr) throw upErr
        if (form.anexar && form.link_id) {
          await anexarNoVinculo({
            employeeId: form.employee_id,
            linkId: form.link_id,
            path,
            clientName: nomeClienteAtual,
            vacancyId: link?.vacancy_id,
          })
        }
        baixarBlob(blob, nomeArquivoContrato(pessoa?.full_name, nomeClienteAtual))
        return { id: contractId, anexou: !!(form.anexar && form.link_id) }
      } catch (e) {
        return { id: contractId, anexou: false, aviso: 'O contrato foi salvo, mas o PDF não foi gerado: ' + (e as Error).message }
      }
    },
    onSuccess: (r) => {
      if (r.aviso) toast.error(r.aviso)
      else toast.success(r.anexou ? 'Contrato salvo e anexado ao vínculo.' : 'Contrato salvo.')
      qc.invalidateQueries({ queryKey: ['contracts'] })
      qc.invalidateQueries({ queryKey: ['contract', r.id] })
      qc.invalidateQueries({ queryKey: ['avisos-sino'] })
      qc.invalidateQueries({ queryKey: ['employee-links'] })
      qc.invalidateQueries({ queryKey: ['employee-docs'] })
      qc.invalidateQueries({ queryKey: ['dashboard-pending-contract-files'] })
      navigate(`/contratos/${r.id}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    salvar.mutate()
  }

  const rotuloVinculo = (l: LinkRow) => {
    const nome = um(l.client)?.name || 'Cliente'
    const fim = l.contract_end_date ? dataBr(l.contract_end_date) : 'sem fim'
    const extra = [
      vinculoEncerrado(l) ? 'encerrado' : '',
      l.contract_file_url ? '' : 'sem contrato',
    ].filter(Boolean).join(' · ')
    return `${nome} · ${rotuloDoVinculo(l)} · ${dataBr(l.start_date) || 'sem início'} a ${fim}${extra ? ' · ' + extra : ''}`
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate(-1)} className="btn-ghost p-2" aria-label="Voltar"><ArrowLeft size={18} /></button>
        <div>
          <p className="eyebrow mb-0.5">Documentos</p>
          <h1 className="page-title-sm">{isEdit ? 'Editar contrato' : 'Novo contrato'}</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <section className="card p-4 sm:p-5 space-y-4">
          <h2 className="text-sm font-semibold text-ink-900">Quem</h2>
          <div>
            <label className="label">Buscar colaborador</label>
            <input className="input" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Colaborador *</label>
              <select className="input" required value={form.employee_id} onChange={e => {
                setForm(f => ({ ...f, employee_id: e.target.value, link_id: '', client_id: '', start_date: '', end_date: '', anexar: false }))
                setTravado(false)
              }}>
                <option value="">Selecionar…</option>
                {pessoasVisiveis.map(p => <option key={p.id} value={p.id}>{p.full_name}{p.status !== 'Ativo' ? ' (inativo)' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Vínculo</label>
              <select className="input" value={form.link_id} disabled={!form.employee_id} onChange={e => escolherVinculo(e.target.value)}>
                <option value="">{form.employee_id ? 'Outro cliente, sem vínculo' : 'Escolha o colaborador'}</option>
                {vinculosOrdenados.map(l => <option key={l.id} value={l.id}>{rotuloVinculo(l)}</option>)}
              </select>
            </div>
          </div>
          {!form.link_id && (
            <div>
              <label className="label">Cliente *</label>
              <select className="input" value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
                <option value="">Selecionar cliente…</option>
                {clientes?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          {form.link_id && cliente && (
            <p className="text-sm text-ink-600">Cliente do vínculo: <strong className="text-ink-900">{cliente.name}</strong>
              {link?.contract_file_url ? ' · este vínculo já tem um arquivo de contrato. Marque abaixo para substituir.' : ' · ainda sem arquivo de contrato.'}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Início</label>
              <input className="input" type="date" value={form.start_date} onChange={e => { setForm(f => ({ ...f, start_date: e.target.value })); setTravado(false) }} />
            </div>
            <div>
              <label className="label">Fim</label>
              <input className="input" type="date" value={form.end_date} onChange={e => { setForm(f => ({ ...f, end_date: e.target.value })); setTravado(false) }} />
            </div>
          </div>
        </section>

        <section className="card p-4 sm:p-5 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-ink-900">Modelo</h2>
            <button type="button" className="text-xs text-primary-700 hover:underline" onClick={() => navigate('/templates/novo')}>Criar modelo</button>
          </div>
          {(templates?.length ?? 0) === 0 && (
            <p className="text-xs text-ink-500">Nenhum modelo salvo ainda. O modelo padrão abaixo já preenche nome, CPF, CNPJ, serviço, valor e datas.</p>
          )}
          <select className="input" value={form.template_id} onChange={e => { setForm(f => ({ ...f, template_id: e.target.value })); setTravado(false) }}>
            <option value={MODELO_PADRAO_ID}>Modelo padrão Time IN</option>
            <option value="">Sem modelo (texto livre)</option>
            {templates?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </section>

        <section className="card p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-ink-900">Prévia</h2>
            <button type="button" className="text-xs text-primary-700 hover:underline" onClick={() => { setConteudo(gerado.texto); setTravado(false) }}>
              Preencher de novo com os dados
            </button>
          </div>
          {faltando.length > 0 && (
            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Ainda sem dado: {faltando.map(k => ROTULO_VARIAVEL[k] || k).join(', ')}. Complete a ficha ou edite o texto.
            </p>
          )}
          <textarea
            className="input font-sans text-sm leading-relaxed min-h-[18rem]"
            value={conteudo}
            onChange={e => { setConteudo(e.target.value); setTravado(true) }}
            placeholder="O texto do contrato aparece aqui."
          />
          <button type="button" className="btn-secondary text-sm" onClick={baixarPrevia}>
            <FileDown size={15} /> Baixar PDF
          </button>
        </section>

        <section className="card p-4 sm:p-5 space-y-4">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="rounded mt-0.5" checked={form.anexar} disabled={!form.link_id}
              onChange={e => setForm(f => ({ ...f, anexar: e.target.checked }))} />
            <span className="text-sm">
              Anexar o PDF ao vínculo
              <span className="block text-xs text-ink-500">O vínculo deixa de aparecer como “sem contrato”. Só vale quando há um vínculo escolhido.</span>
            </span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="rounded" checked={form.signed} onChange={e => setForm(f => ({ ...f, signed: e.target.checked }))} />
              <span className="text-sm">Já assinado</span>
            </label>
            {form.signed && (
              <div>
                <label className="label">Data da assinatura</label>
                <input className="input" type="date" value={form.signed_at} onChange={e => setForm(f => ({ ...f, signed_at: e.target.value }))} />
              </div>
            )}
          </div>
          <details className="border border-ink-100 rounded-lg px-3 py-2">
            <summary className="text-sm font-medium cursor-pointer">Supervisão e observações</summary>
            <div className="space-y-3 pt-3">
              <div>
                <label className="label">Responsável interno</label>
                <input className="input" value={form.employee_responsible} onChange={e => setForm(f => ({ ...f, employee_responsible: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="rounded" checked={form.requires_supervision} onChange={e => setForm(f => ({ ...f, requires_supervision: e.target.checked }))} />
                <span className="text-sm">Requer supervisão</span>
              </label>
              {form.requires_supervision && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Visitas por mês</label>
                    <input className="input" type="number" min="0" value={form.supervision_visits_per_month} onChange={e => setForm(f => ({ ...f, supervision_visits_per_month: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Supervisor</label>
                    <select className="input" value={form.supervisor_id} onChange={e => setForm(f => ({ ...f, supervisor_id: e.target.value }))}>
                      <option value="">Selecionar…</option>
                      {supervisors?.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.role})</option>)}
                    </select>
                  </div>
                </div>
              )}
              <div>
                <label className="label">Observações internas</label>
                <textarea className="input" rows={3} value={form.observations} onChange={e => setForm(f => ({ ...f, observations: e.target.value }))} />
              </div>
            </div>
          </details>
        </section>

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => navigate(-1)}>Cancelar</button>
          <button type="submit" className="btn-primary w-full sm:w-auto" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar e gerar PDF'}
          </button>
        </div>
      </form>
    </div>
  )
}
