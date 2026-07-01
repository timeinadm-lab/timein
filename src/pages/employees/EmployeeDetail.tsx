import { useState, useRef } from 'react'
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Edit, Plus, Trash2, CheckCircle, Clock, XCircle, Download, Upload, ExternalLink, AlertTriangle, Star } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatCurrency, getInitials } from '../../lib/utils'
import { exportEmployeeToPDF } from '../../lib/exportUtils'
import { SignedLink, SignedImage } from '../../components/ui/SignedFile'
import DeletePinModal from '../../components/ui/DeletePinModal'
import { useAuth } from '../../contexts/AuthContext'
import toast from 'react-hot-toast'
import { format, startOfMonth, endOfMonth, getDaysInMonth, getDay, differenceInDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { EmployeeClientLink, EmployeePaymentDate } from '../../types'

type Tab = 'visao' | 'ficha' | 'vinculos' | 'pagamentos' | 'agenda' | 'visitas' | 'arquivos' | 'historico' | 'portal'

const DOC_STATUS_OPTIONS = ['Entregue', 'Pendente', 'Não se aplica'] as const
type DocStatus = typeof DOC_STATUS_OPTIONS[number]

const DOC_ICON = {
  'Entregue': <CheckCircle size={16} className="text-green-500" />,
  'Pendente': <Clock size={16} className="text-amber-500" />,
  'Não se aplica': <XCircle size={16} className="text-gray-400" />,
}

export default function EmployeeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const qc = useQueryClient()
  const { role } = useAuth()
  const initialTab = (searchParams.get('tab') as Tab) || 'visao'
  const [tab, setTab] = useState<Tab>(initialTab)
  const [payMonth, setPayMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [agendaMonth, setAgendaMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [visMonth, setVisMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [showAgendaForm, setShowAgendaForm] = useState(false)
  const [agendaForm, setAgendaForm] = useState({ client_id: '', unit_id: '', planned_date: '', notes: '', hours_expected: '' })
  const [showHistoryForm, setShowHistoryForm] = useState(false)
  const [histForm, setHistForm] = useState({ type: 'Anotação', description: '', responsible: '' })
  const [showLinkForm, setShowLinkForm] = useState(false)
  const [linkForm, setLinkForm] = useState({ client_id: '', service_type: 'Fixo' as 'Fixo' | 'Consultoria', monthly_amount: '', cost_assistance: '', weekly_hours_quota: '', visit_frequency: 'Semanal' as 'Semanal' | 'Quinzenal' | 'Mensal', contract_end_date: '', work_schedule_type: '', daily_hours: '', days_off: [] as number[], schedule_anchor_date: '' })
  type EditLinkUnit = { unit_id: string; unit_name: string; visit_rate: string }
  type EditLinkState = { linkId: string; serviceType: string; clientId: string; monthly_amount: string; cost_assistance: string; weekly_hours: string; visit_frequency: string; visits_per_week: string; pay_extra_visits: boolean; units: EditLinkUnit[]; work_schedule_type: string; daily_hours: string; days_off: number[]; schedule_anchor_date: string; start_date: string; payDays: string[]; pay_full_salary: boolean }
  const [editLinkValues, setEditLinkValues] = useState<EditLinkState | null>(null)
  const [linkDates, setLinkDates] = useState<{ day_of_month: string; amount: string }[]>([{ day_of_month: '', amount: '' }])
  const [newDocName, setNewDocName] = useState('')
  const linkFileRef = useRef<HTMLInputElement>(null)
  const [uploadingLinkId, setUploadingLinkId] = useState<string | null>(null)
  const [editContractDate, setEditContractDate] = useState<{ linkId: string; date: string } | null>(null)
  const [confirmRemoveLinkId, setConfirmRemoveLinkId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editVisitId, setEditVisitId] = useState<string | null>(null)
  const [editVisitForm, setEditVisitForm] = useState({ check_in: '', check_out: '', observations: '' })
  const [showCoverageForm, setShowCoverageForm] = useState(false)
  type CoverageUnit = { unit_id: string; unit_name: string; visit_rate: string }
  const [coverageForm, setCoverageForm] = useState({
    client_id: '', coverage_type: 'Fixo' as 'Fixo' | 'Consultoria',
    // Fixo
    unit_id: '', work_schedule_type: '', daily_hours: '', days_off: [] as number[], schedule_anchor_date: '',
    // Consultoria
    coverage_units: [] as CoverageUnit[], visit_frequency: 'Semanal' as 'Semanal' | 'Quinzenal' | 'Mensal', weekly_hours_quota: '',
    // Comum
    start_date: '', end_date: '', daily_rate: '',
  })
  const [extendLinkId, setExtendLinkId] = useState<string | null>(null)
  const [newEndDate, setNewEndDate] = useState('')

  const deleteEmployee = useMutation({
    mutationFn: async () => {
      // Revert any contracted vacancy_interests so vacancy counts stay accurate
      await supabase.from('vacancy_interests')
        .update({ status: 'Interessado', hired_at: null, employee_id: null })
        .eq('employee_id', id)
      // Remove related records first to avoid FK violations
      await supabase.from('employee_client_links').delete().eq('employee_id', id)
      await supabase.from('employee_documents').delete().eq('employee_id', id)
      await supabase.from('employee_history').delete().eq('employee_id', id)
      await supabase.from('payments').delete().eq('employee_id', id)
      const { error } = await supabase.from('employees').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Colaborador excluído.')
      qc.invalidateQueries({ queryKey: ['employees'] })
      navigate('/colaboradores')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleFavorite = useMutation({
    mutationFn: async (val: boolean) => {
      const { error } = await supabase.from('employees').update({ is_favorite: val }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee', id] })
      qc.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { data: employee } = useQuery({
    queryKey: ['employee', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('*').eq('id', id).single()
      if (error) throw error
      return data
    },
  })

  const { data: docs } = useQuery({
    queryKey: ['employee-docs', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_documents').select('*').eq('employee_id', id).order('name')
      if (error) throw error
      return data || []
    },
  })

  const { data: links } = useQuery({
    queryKey: ['employee-links', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_client_links')
        .select('*,client:clients(id,name),payment_dates:employee_payment_dates(*)')
        .eq('employee_id', id)
      if (error) throw error
      return (data || []) as (EmployeeClientLink & { payment_dates: EmployeePaymentDate[] })[]
    },
  })

  const { data: allClients } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id,name').order('name')
      if (error) throw error
      return data || []
    },
  })

  const { data: editClientUnits } = useQuery({
    queryKey: ['edit-client-units', editLinkValues?.clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_units').select('id,name').eq('client_id', editLinkValues!.clientId).order('name')
      if (error) throw error
      return data || []
    },
    enabled: !!editLinkValues?.clientId && editLinkValues.serviceType === 'Consultoria',
  })

  const { data: payChecks } = useQuery({
    queryKey: ['pay-checks', id, payMonth],
    queryFn: async () => {
      if (!links?.length) return []
      const dateIds = links.flatMap(l => l.payment_dates?.map(d => d.id) ?? [])
      if (!dateIds.length) return []
      const { data, error } = await supabase
        .from('employee_payment_checks')
        .select('*,payment_date:employee_payment_dates(*)')
        .in('payment_date_id', dateIds)
        .eq('reference_month', payMonth)
      if (error) throw error
      return data || []
    },
    enabled: !!links,
  })

  const { data: history } = useQuery({
    queryKey: ['employee-history', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_history').select('*').eq('employee_id', id).order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: linkHistory } = useQuery({
    queryKey: ['link-history', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('link_history')
        .select('*')
        .eq('employee_id', id)
        .order('changed_at', { ascending: false })
      if (error) return []
      return data || []
    },
    enabled: tab === 'historico',
  })

  // Passagens: onde ele já esteve (vagas Fixo/Consultoria + coberturas Volante)
  const { data: placements } = useQuery({
    queryKey: ['employee-placements', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('placements_history')
        .select('*')
        .eq('employee_id', id)
        .order('end_date', { ascending: false })
      if (error) return []
      return data || []
    },
    enabled: tab === 'historico',
  })

  const { data: agendaItems } = useQuery({
    queryKey: ['employee-agenda', id, agendaMonth],
    queryFn: async () => {
      const start = agendaMonth + '-01'
      const end = format(endOfMonth(new Date(agendaMonth + '-01')), 'yyyy-MM-dd')
      const { data, error } = await supabase
        .from('nutritionist_agenda')
        .select('*,client:clients(name),unit:client_units(name)')
        .eq('employee_id', id)
        .gte('planned_date', start)
        .lte('planned_date', end)
        .order('planned_date')
      if (error) throw error
      return data || []
    },
    enabled: tab === 'agenda',
  })

  const { data: visitHistory } = useQuery({
    queryKey: ['employee-visit-history', id, visMonth],
    queryFn: async () => {
      const start = visMonth + '-01'
      const end = format(endOfMonth(new Date(visMonth + '-01')), 'yyyy-MM-dd')
      const { data, error } = await supabase
        .from('nutritionist_visits')
        .select('*,client:clients(name)')
        .eq('employee_id', id)
        .gte('visit_date', start)
        .lte('visit_date', end)
        .order('visit_date')
      if (error) throw error
      return data || []
    },
    enabled: tab === 'visitas',
  })

  const { data: clientsForCoverage } = useQuery({
    queryKey: ['clients-for-coverage'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name').order('name')
      if (error) throw error
      return data || []
    },
    enabled: (employee as { employee_type?: string } | undefined)?.employee_type === 'Volante' && tab === 'vinculos',
  })

  const { data: coverageClientUnits } = useQuery({
    queryKey: ['coverage-client-units', coverageForm.client_id],
    queryFn: async () => {
      const { data } = await supabase.from('client_units').select('id,name').eq('client_id', coverageForm.client_id).order('name')
      return data || []
    },
    enabled: !!coverageForm.client_id,
  })

  const EMPTY_COVERAGE = { client_id: '', coverage_type: 'Fixo' as 'Fixo' | 'Consultoria', unit_id: '', work_schedule_type: '', daily_hours: '', days_off: [] as number[], schedule_anchor_date: '', coverage_units: [] as CoverageUnit[], visit_frequency: 'Semanal' as 'Semanal' | 'Quinzenal' | 'Mensal', weekly_hours_quota: '', start_date: '', end_date: '', daily_rate: '' }

  const addCoverage = useMutation({
    mutationFn: async () => {
      const isFixo = coverageForm.coverage_type === 'Fixo'
      let linkUnits: { unit_id: string; unit_name: string; visit_rate?: number }[] | null = null
      let monthlyHours: number | null = null
      if (isFixo) {
        const unit = (coverageClientUnits || []).find(u => u.id === coverageForm.unit_id)
        if (unit) linkUnits = [{ unit_id: unit.id, unit_name: unit.name }]
      } else {
        const active = coverageForm.coverage_units.filter(u => u.visit_rate)
        linkUnits = active.length > 0 ? active.map(u => ({ unit_id: u.unit_id, unit_name: u.unit_name, visit_rate: Number(u.visit_rate) })) : null
        const wh = Number(coverageForm.weekly_hours_quota) || null
        if (wh) monthlyHours = wh * (coverageForm.visit_frequency === 'Mensal' ? 1 : coverageForm.visit_frequency === 'Quinzenal' ? 2 : 4)
      }
      const { error } = await supabase.from('employee_client_links').insert({
        employee_id: id,
        client_id: coverageForm.client_id || null,
        service_type: 'Volante',
        coverage_type: coverageForm.coverage_type,
        daily_rate: Number(coverageForm.daily_rate) || null,
        start_date: coverageForm.start_date || null,
        contract_end_date: coverageForm.end_date || null,
        monthly_amount: null,
        link_units: linkUnits,
        ...(isFixo ? {
          work_schedule_type: coverageForm.work_schedule_type || null,
          daily_hours: coverageForm.daily_hours ? Number(coverageForm.daily_hours) : null,
          days_off: coverageForm.work_schedule_type !== '12x36' ? coverageForm.days_off : [],
          schedule_anchor_date: coverageForm.work_schedule_type === '12x36' ? (coverageForm.schedule_anchor_date || null) : null,
        } : {
          visit_frequency: coverageForm.visit_frequency,
          weekly_hours_quota: Number(coverageForm.weekly_hours_quota) || null,
          monthly_hours_quota: monthlyHours,
        }),
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Cobertura adicionada!')
      qc.invalidateQueries({ queryKey: ['employee-links', id] })
      setShowCoverageForm(false)
      setCoverageForm(EMPTY_COVERAGE)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const extendCoverage = useMutation({
    mutationFn: async ({ linkId, endDate }: { linkId: string; endDate: string }) => {
      const { error } = await supabase.from('employee_client_links')
        .update({ contract_end_date: endDate })
        .eq('id', linkId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Cobertura estendida!')
      qc.invalidateQueries({ queryKey: ['employee-links', id] })
      setExtendLinkId(null)
      setNewEndDate('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateVisit = useMutation({
    mutationFn: async ({ visitId, check_in, check_out, observations }: { visitId: string; check_in: string; check_out: string; observations: string }) => {
      const { error } = await supabase.from('nutritionist_visits')
        .update({ check_in: check_in || null, check_out: check_out || null, observations: observations || null })
        .eq('id', visitId)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Visita atualizada!'); qc.invalidateQueries({ queryKey: ['employee-visit-history', id, visMonth] }); setEditVisitId(null) },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateDoc = useMutation({
    mutationFn: async ({ docId, status }: { docId: string; status: DocStatus }) => {
      const { error } = await supabase.from('employee_documents').update({ status }).eq('id', docId)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Documento atualizado!'); qc.invalidateQueries({ queryKey: ['employee-docs', id] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const addDoc = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('employee_documents').insert({ employee_id: id, name: newDocName, status: 'Pendente' })
      if (error) throw error
    },
    onSuccess: () => { toast.success('Documento adicionado!'); qc.invalidateQueries({ queryKey: ['employee-docs', id] }); setNewDocName('') },
    onError: (e: Error) => toast.error(e.message),
  })

  const { data: agendaClientUnits } = useQuery({
    queryKey: ['agenda-client-units', agendaForm.client_id],
    queryFn: async () => {
      const { data } = await supabase.from('client_units').select('id,name').eq('client_id', agendaForm.client_id).order('name')
      return data || []
    },
    enabled: !!agendaForm.client_id,
  })

  const addAgendaItem = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('nutritionist_agenda').insert({
        employee_id: id,
        client_id: agendaForm.client_id,
        unit_id: agendaForm.unit_id || null,
        planned_date: agendaForm.planned_date,
        notes: agendaForm.notes || null,
        hours_expected: agendaForm.hours_expected ? Number(agendaForm.hours_expected) : null,
        created_by_admin: true,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Data agendada!')
      qc.invalidateQueries({ queryKey: ['employee-agenda', id, agendaMonth] })
      setShowAgendaForm(false)
      setAgendaForm({ client_id: '', unit_id: '', planned_date: '', notes: '', hours_expected: '' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteAgendaItem = useMutation({
    mutationFn: async (agendaId: string) => {
      const { error } = await supabase.from('nutritionist_agenda').delete().eq('id', agendaId)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Removido.'); qc.invalidateQueries({ queryKey: ['employee-agenda', id, agendaMonth] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null)
  const docFileRef = useRef<HTMLInputElement>(null)
  const [pendingDocUpload, setPendingDocUpload] = useState<string | null>(null)

  // Documentos simplificados: nome + arquivo direto
  const [newDocFile, setNewDocFile] = useState<File | null>(null)
  const [newDocLabel, setNewDocLabel] = useState('')
  const [uploadingNewDoc, setUploadingNewDoc] = useState(false)
  const newDocFileRef = useRef<HTMLInputElement>(null)

  const deleteDoc = useMutation({
    mutationFn: async ({ docId, fileUrl }: { docId: string; fileUrl?: string }) => {
      if (fileUrl) await supabase.storage.from('arquivos').remove([fileUrl])
      const { error } = await supabase.from('employee_documents').delete().eq('id', docId)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Documento removido.'); qc.invalidateQueries({ queryKey: ['employee-docs', id] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const uploadNewDoc = async () => {
    if (!newDocLabel.trim()) { toast.error('Dê um nome ao documento.'); return }
    setUploadingNewDoc(true)
    try {
      let fileUrl: string | undefined
      if (newDocFile) {
        const ext = newDocFile.name.split('.').pop()
        const safeName = newDocLabel.trim().replace(/[^a-zA-Z0-9\-_]/g, '_')
        const path = `emp/${id}/${safeName}_${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from('arquivos').upload(path, newDocFile, { upsert: false })
        if (upErr) { toast.error('Erro ao enviar: ' + upErr.message); return }
        fileUrl = path
      }
      const { error } = await supabase.from('employee_documents').insert({
        employee_id: id,
        name: newDocLabel.trim(),
        status: fileUrl ? 'Entregue' : 'Pendente',
        ...(fileUrl ? { file_url: fileUrl } : {}),
      })
      if (error) throw error
      toast.success('Documento salvo!')
      qc.invalidateQueries({ queryKey: ['employee-docs', id] })
      setNewDocLabel('')
      setNewDocFile(null)
    } finally {
      setUploadingNewDoc(false)
    }
  }

  const uploadDocFile = async (docId: string, file: File) => {
    setUploadingDocId(docId)
    try {
      const ext = file.name.split('.').pop()
      const path = `emp/${id}/${docId}.${ext}`
      const { error: upErr } = await supabase.storage.from('arquivos').upload(path, file, { upsert: true })
      if (upErr) { toast.error('Erro ao enviar arquivo: ' + upErr.message); return }
      await supabase.from('employee_documents').update({ file_url: path, status: 'Entregue' }).eq('id', docId)
      qc.invalidateQueries({ queryKey: ['employee-docs', id] })
      toast.success('Arquivo enviado!')
    } finally {
      setUploadingDocId(null)
      setPendingDocUpload(null)
    }
  }

  const addHistory = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('employee_history').insert({ employee_id: id, ...histForm })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Histórico adicionado!')
      qc.invalidateQueries({ queryKey: ['employee-history', id] })
      setShowHistoryForm(false)
      setHistForm({ type: 'Anotação', description: '', responsible: '' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const addLink = useMutation({
    mutationFn: async () => {
      const isConsultoria = linkForm.service_type === 'Consultoria'
      // Consultoria: valores por unidade são configurados no Editar do vínculo; estimativa vem de lá
      const monthlyAmt = isConsultoria ? null : (linkForm.monthly_amount ? Number(linkForm.monthly_amount) : null)
      const { data: linkData, error } = await supabase.from('employee_client_links').insert({
        employee_id: id,
        client_id: linkForm.client_id,
        service_type: linkForm.service_type,
        monthly_amount: monthlyAmt,
        cost_assistance: linkForm.cost_assistance ? Number(linkForm.cost_assistance) : 0,
        visit_frequency: isConsultoria ? linkForm.visit_frequency : null,
        weekly_hours_quota: linkForm.weekly_hours_quota ? Number(linkForm.weekly_hours_quota) : null,
        monthly_hours_quota: isConsultoria && linkForm.weekly_hours_quota ? Number(linkForm.weekly_hours_quota) * (linkForm.visit_frequency === 'Mensal' ? 1 : linkForm.visit_frequency === 'Quinzenal' ? 2 : 4) : null,
        contract_end_date: linkForm.contract_end_date || null,
        // Escala (Fixo): sem ela o portal não cobra os dias nem calcula hora extra
        work_schedule_type: !isConsultoria ? (linkForm.work_schedule_type || null) : null,
        daily_hours: !isConsultoria && linkForm.daily_hours ? Number(linkForm.daily_hours) : null,
        days_off: !isConsultoria && linkForm.days_off.length ? linkForm.days_off : null,
        schedule_anchor_date: !isConsultoria && linkForm.work_schedule_type === '12x36' && linkForm.schedule_anchor_date ? linkForm.schedule_anchor_date : null,
      }).select('id').single()
      if (error) throw error
      // Auto-set payment dates: Consultoria = dia 8 e 20, Fixo = dia 8 (default)
      const autoDays = isConsultoria ? [8, 20] : [8]
      const perDate = monthlyAmt ? Math.round((monthlyAmt / autoDays.length) * 100) / 100 : null
      await supabase.from('employee_payment_dates').insert(
        autoDays.map(d => ({ link_id: linkData.id, day_of_month: d, amount: perDate }))
      )

      // Auto-generate payment for current month — só chefe pode gravar em 'payments' (RLS).
      // Se for recrutador, o insert é ignorado silenciosamente (o chefe gera depois).
      if (monthlyAmt) {
        const { data: empData } = await supabase.from('employees').select('full_name').eq('id', id!).single()
        const { data: clientData } = await supabase.from('clients').select('name').eq('id', linkForm.client_id).single()
        const now = new Date()
        const dueDay = autoDays[0]
        const dueDate = new Date(now.getFullYear(), now.getMonth(), dueDay)
        if (dueDate < now) dueDate.setMonth(dueDate.getMonth() + 1)
        const monthLabel = dueDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
        await supabase.from('payments').insert({
          description: `Honorários – ${empData?.full_name || ''}${clientData?.name ? ` (${clientData.name})` : ''} – ${monthLabel}`,
          amount: monthlyAmt,
          due_date: dueDate.toISOString().slice(0, 10),
          status: 'Pendente',
          recurrence: 'Mensal',
          category: 'Salário',
          type: 'Estimativa',
          employee_id: id,
          reference_month: dueDate.toISOString().slice(0, 7),
        }) // erro de RLS (recrutador) não interrompe a criação do vínculo
      }
    },
    onSuccess: () => {
      toast.success('Vínculo adicionado!')
      qc.invalidateQueries({ queryKey: ['employee-links', id] })
      setShowLinkForm(false)
      setLinkForm({ client_id: '', service_type: 'Fixo', monthly_amount: '', cost_assistance: '', weekly_hours_quota: '', visit_frequency: 'Semanal', contract_end_date: '', work_schedule_type: '', daily_hours: '', days_off: [], schedule_anchor_date: '' })
      setLinkDates([{ day_of_month: '', amount: '' }])
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const removeLink = useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase.from('employee_client_links').delete().eq('id', linkId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Vínculo removido!')
      qc.invalidateQueries({ queryKey: ['employee-links', id] })
      qc.invalidateQueries({ queryKey: ['employees'] })
      setConfirmRemoveLinkId(null)
    },
    onError: (e: Error) => { toast.error(e.message); setConfirmRemoveLinkId(null) },
  })

  const updateLinkValues = useMutation({
    mutationFn: async (vals: EditLinkState) => {
      const isConsult = vals.serviceType === 'Consultoria'
      let monthly: number | null = null
      let linkUnits: unknown = null
      if (isConsult) {
        const activeUnits = vals.units.filter(u => u.visit_rate)
        linkUnits = activeUnits.map(u => ({ unit_id: u.unit_id, unit_name: u.unit_name, visit_rate: Number(u.visit_rate) }))
        // Estimativa mensal = média dos valores das unidades × 4 semanas (o real vem da folha de ponto)
        const avgRate = activeUnits.length ? activeUnits.reduce((s, u) => s + Number(u.visit_rate), 0) / activeUnits.length : 0
        monthly = avgRate > 0 ? Math.round(avgRate * 4 * 100) / 100 : null
      } else {
        monthly = vals.monthly_amount ? Number(vals.monthly_amount) : null
      }
      const { error } = await supabase.from('employee_client_links').update({
        monthly_amount: monthly,
        cost_assistance: vals.cost_assistance ? Number(vals.cost_assistance) : 0,
        link_units: linkUnits,
        visit_frequency: isConsult ? (vals.visit_frequency || 'Semanal') : undefined,
        weekly_hours_quota: isConsult ? (vals.weekly_hours ? Number(vals.weekly_hours) : null) : undefined,
        monthly_hours_quota: isConsult ? (vals.weekly_hours ? Number(vals.weekly_hours) * (vals.visit_frequency === 'Mensal' ? 1 : vals.visit_frequency === 'Quinzenal' ? 2 : 4) : null) : undefined,
        // Regras do combinado: quantas visitas por semana e se paga além disso
        visits_per_week: isConsult ? (vals.visits_per_week ? Number(vals.visits_per_week) : null) : undefined,
        pay_extra_visits: isConsult ? vals.pay_extra_visits : undefined,
        // Escala (Fixo) — portal usa para cobrar dias e calcular hora extra
        work_schedule_type: !isConsult ? (vals.work_schedule_type || null) : undefined,
        daily_hours: !isConsult ? (vals.daily_hours ? Number(vals.daily_hours) : null) : undefined,
        days_off: !isConsult ? (vals.days_off.length ? vals.days_off : null) : undefined,
        schedule_anchor_date: !isConsult ? (vals.work_schedule_type === '12x36' && vals.schedule_anchor_date ? vals.schedule_anchor_date : null) : undefined,
        start_date: !isConsult ? (vals.start_date || null) : undefined,
        pay_full_salary: !isConsult ? vals.pay_full_salary : undefined,
      }).eq('id', vals.linkId)
      if (error) throw error

      // Consultoria sempre dia 8 e 20; Fixo só aceita 8, 15 ou 20
      const allowedDays = isConsult ? [8, 20] : vals.payDays.map(d => Number(d)).filter(d => [8, 15, 20].includes(d))
      const cleanDays = [...new Set(isConsult ? allowedDays : allowedDays)]
      await supabase.from('employee_payment_dates').delete().eq('link_id', vals.linkId)
      if (cleanDays.length) {
        const perDate = monthly != null ? Math.round((monthly / cleanDays.length) * 100) / 100 : null
        await supabase.from('employee_payment_dates').insert(
          cleanDays.map(d => ({ link_id: vals.linkId, day_of_month: d, amount: perDate }))
        )
      }
    },
    onSuccess: () => {
      toast.success('Valores atualizados!')
      qc.invalidateQueries({ queryKey: ['employee-links', id] })
      setEditLinkValues(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const uploadLinkContract = async (linkId: string, file: File) => {
    setUploadingLinkId(linkId)
    try {
      const path = `employees/${id}/${linkId}_${Date.now()}.pdf`
      const { error: upErr } = await supabase.storage.from('arquivos').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { error: updErr } = await supabase.from('employee_client_links').update({ contract_file_url: path }).eq('id', linkId)
      if (updErr) throw updErr

      // Também registra o contrato na aba Documentos do colaborador
      const link = links?.find(l => l.id === linkId)
      const clientName = (link as { client?: { name?: string } } | undefined)?.client?.name
      const docName = `Contrato assinado${clientName ? ' — ' + clientName : ''}`
      const { data: existingDocs } = await supabase.from('employee_documents')
        .select('id').eq('employee_id', id).eq('name', docName).limit(1)
      if (existingDocs?.[0]) {
        await supabase.from('employee_documents').update({ file_url: path, status: 'Entregue' }).eq('id', existingDocs[0].id)
      } else {
        await supabase.from('employee_documents').insert({ employee_id: id, name: docName, status: 'Entregue', file_url: path })
      }

      toast.success('Contrato anexado! Também salvo em Documentos.')
      qc.invalidateQueries({ queryKey: ['employee-links', id] })
      qc.invalidateQueries({ queryKey: ['employee-docs', id] })
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setUploadingLinkId(null)
    }
  }

  // ── Expenses ──────────────────────────────────────────────────────────────
  const [showExpForm, setShowExpForm] = useState(false)
  const [expForm, setExpForm] = useState({ description: '', amount: '', category: 'Reembolso', notes: '' })
  const expReceiptRef = useRef<HTMLInputElement>(null)
  const [uploadingExpId, setUploadingExpId] = useState<string | null>(null)
  const [pendingExpUpload, setPendingExpUpload] = useState<string | null>(null)

  const { data: expenses } = useQuery({
    queryKey: ['employee-expenses', id, payMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_expenses')
        .select('*')
        .eq('employee_id', id)
        .eq('reference_month', payMonth)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const addExpense = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('employee_expenses').insert({
        employee_id: id,
        description: expForm.description,
        amount: Number(expForm.amount),
        category: expForm.category,
        notes: expForm.notes || null,
        reference_month: payMonth,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Gasto registrado!')
      qc.invalidateQueries({ queryKey: ['employee-expenses', id, payMonth] })
      setShowExpForm(false)
      setExpForm({ description: '', amount: '', category: 'Reembolso', notes: '' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const uploadExpReceipt = async (expId: string, file: File) => {
    setUploadingExpId(expId)
    try {
      const ext = file.name.split('.').pop()
      const path = `receipts/${id}/${expId}.${ext}`
      const { error: upErr } = await supabase.storage.from('arquivos').upload(path, file, { upsert: true })
      if (upErr) { toast.error('Erro ao enviar: ' + upErr.message); return }
      await supabase.from('employee_expenses').update({ receipt_url: path }).eq('id', expId)
      qc.invalidateQueries({ queryKey: ['employee-expenses', id, payMonth] })
      toast.success('Comprovante enviado!')
    } finally {
      setUploadingExpId(null)
      setPendingExpUpload(null)
    }
  }

  const saveContractEndDate = async (linkId: string, date: string) => {
    const { error } = await supabase.from('employee_client_links').update({ contract_end_date: date || null }).eq('id', linkId)
    if (error) toast.error(error.message)
    else { toast.success('Data salva!'); qc.invalidateQueries({ queryKey: ['employee-links', id] }); setEditContractDate(null) }
  }

  const generatePayChecks = useMutation({
    mutationFn: async () => {
      if (!links?.length) return
      const records = links.flatMap(l => (l.payment_dates ?? []).map(d => ({
        payment_date_id: d.id,
        reference_month: payMonth,
        paid: false,
      })))
      if (!records.length) { toast('Nenhuma data de pagamento cadastrada'); return }
      const { error } = await supabase.from('employee_payment_checks').upsert(records, { onConflict: 'payment_date_id,reference_month' })
      if (error) throw error
    },
    onSuccess: () => { toast.success('Checklist gerado!'); qc.invalidateQueries({ queryKey: ['pay-checks', id, payMonth] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const togglePaid = useMutation({
    mutationFn: async ({ checkId, paid }: { checkId: string; paid: boolean }) => {
      const { error } = await supabase.from('employee_payment_checks').update({ paid }).eq('id', checkId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pay-checks', id, payMonth] }),
    onError: (e: Error) => toast.error(e.message),
  })

  if (!employee) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" /></div>

  const linkedClientIds = new Set(links?.map(l => l.client_id) ?? [])
  const availableClients = allClients?.filter(c => !linkedClientIds.has(c.id)) ?? []

  const paidCount = payChecks?.filter(c => c.paid).length ?? 0
  const totalCount = payChecks?.length ?? 0
  const totalAmount = payChecks?.filter(c => c.paid).reduce((s, c) => s + (c.payment_date?.amount ?? 0), 0) ?? 0

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <button onClick={() => navigate(-1)} className="btn-ghost px-2 -ml-2 text-sm"><ArrowLeft size={16} />Voltar</button>

      {/* Hero do perfil */}
      <div className="card p-4 md:p-5">
        <div className="flex items-start gap-4">
          {employee.photo_url ? (
            <SignedImage value={employee.photo_url} bucket="fotos de funcionários" alt={employee.full_name} className="w-16 h-16 rounded-2xl object-cover flex-shrink-0 ring-2 ring-white shadow-soft"
              fallback={<div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-display font-extrabold text-xl flex-shrink-0">{getInitials(employee.full_name)}</div>} />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-display font-extrabold text-xl flex-shrink-0">
              {getInitials(employee.full_name)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl md:text-2xl font-display font-extrabold text-ink-900 truncate">{employee.full_name}</h1>
            <p className="text-sm text-ink-500">{employee.role || 'Sem cargo'}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <span className={`badge ${employee.status === 'Ativo' ? 'bg-primary-100 text-primary-700' : employee.status === 'Inativo' ? 'bg-gray-100 text-gray-500' : 'bg-ink-100 text-ink-600'}`}>{employee.status}</span>
              {employee.crn_number && <span className="badge bg-blue-50 text-blue-700">CRN {employee.crn_number}/{employee.crn_region}</span>}
              {(employee as { employee_type?: string }).employee_type === 'Volante' ? (
                <span className="badge bg-orange-100 text-orange-700">⚡ Volante</span>
              ) : (
                [...new Set((links || []).filter(l => l.service_type !== 'Volante').map(l => l.service_type))].map(st => (
                  <span key={st} className={`badge ${st === 'Consultoria' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{st}</span>
                ))
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4 pt-4 border-t border-ink-100">
          <button onClick={() => exportEmployeeToPDF(employee, docs ?? [])} className="btn-secondary text-sm flex-1 md:flex-none"><Download size={16} /><span className="hidden sm:inline">PDF</span></button>
          <button onClick={() => navigate(`/colaboradores/${id}/editar`)} className="btn-secondary text-sm flex-1 md:flex-none"><Edit size={16} /><span className="hidden sm:inline">Editar</span></button>
          <button
            onClick={() => toggleFavorite.mutate(!(employee as { is_favorite?: boolean }).is_favorite)}
            className={`btn-secondary text-sm flex-1 md:flex-none ${(employee as { is_favorite?: boolean }).is_favorite ? 'text-amber-500 border-amber-300 bg-amber-50 hover:bg-amber-100' : ''}`}
            title={(employee as { is_favorite?: boolean }).is_favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          >
            <Star size={16} fill={(employee as { is_favorite?: boolean }).is_favorite ? 'currentColor' : 'none'} />
            <span className="hidden sm:inline">{(employee as { is_favorite?: boolean }).is_favorite ? 'Favorito' : 'Favoritar'}</span>
          </button>
          <button onClick={() => setConfirmDelete(true)} className="btn-secondary text-sm flex-1 md:flex-none text-red-600 hover:bg-red-50 border-red-200"><Trash2 size={16} /><span className="hidden sm:inline">Excluir</span></button>
        </div>
      </div>

      {/* Confirm delete modal — exige PIN */}
      <DeletePinModal
        open={confirmDelete}
        title="Excluir colaborador?"
        description={`Remove ${employee.full_name} permanentemente: vínculos, arquivos, histórico e pagamentos.`}
        confirmLabel="Excluir colaborador"
        onConfirmed={() => deleteEmployee.mutateAsync()}
        onClose={() => setConfirmDelete(false)}
      />

      {/* Tabs — pílulas roláveis */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
        {(['visao', 'ficha', 'vinculos', 'pagamentos', 'agenda', 'visitas', 'arquivos', 'historico', 'portal'] as Tab[]).filter(t => t !== 'pagamentos' || role === 'chefe').map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3.5 py-2 text-sm font-semibold whitespace-nowrap rounded-xl transition-all active:scale-95 ${tab === t ? 'bg-primary-600 text-white shadow-soft' : 'bg-white border border-ink-100 text-ink-500 hover:text-ink-800 hover:border-ink-200'}`}>
            {t === 'visao' ? 'Visão Geral' : t === 'vinculos' ? 'Vínculos' : t === 'agenda' ? 'Agenda' : t === 'visitas' ? 'Visitas' : t === 'arquivos' ? 'Documentos' : t === 'historico' ? 'Histórico' : t === 'portal' ? 'Portal' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* VISÃO GERAL */}
      {tab === 'visao' && (
        <VisaoGeral employeeId={id!} employee={employee} links={links ?? []} docs={docs ?? []} />
      )}

      {/* FICHA */}
      {tab === 'ficha' && (
        <div className="space-y-4">
          {/* Identificação */}
          <div className="card p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Identificação</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-xs text-gray-400">CPF</span><p className="font-mono">{employee.cpf || <span className="text-orange-400 text-xs">⚠️ Pendente</span>}</p></div>
              <div><span className="text-xs text-gray-400">RG</span><p className="font-mono">{(employee as { rg?: string }).rg || '-'}</p></div>
              <div><span className="text-xs text-gray-400">Data de Nascimento</span><p>{formatDate(employee.birth_date)}</p></div>
              <div><span className="text-xs text-gray-400">Admissão</span><p>{formatDate(employee.admission_date)}</p></div>
              {employee.status === 'Inativo' && employee.dismissal_date && <>
                <div><span className="text-xs text-gray-400">Data de Saída</span><p>{formatDate(employee.dismissal_date)}</p></div>
                <div><span className="text-xs text-gray-400">Motivo</span><p>{employee.dismissal_reason || '-'}</p></div>
              </>}
            </div>
          </div>

          {/* Contato */}
          <div className="card p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Contato</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-xs text-gray-400">Telefone</span><p>{(employee as { phone?: string }).phone || '-'}</p></div>
              <div>
                <span className="text-xs text-gray-400">WhatsApp</span>
                {employee.whatsapp ? (
                  <a
                    href={`https://wa.me/55${employee.whatsapp.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-green-600 hover:text-green-700 hover:underline font-medium"
                  >
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current flex-shrink-0"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    {employee.whatsapp}
                  </a>
                ) : <p>-</p>}
              </div>
              <div className="col-span-2"><span className="text-xs text-gray-400">E-mail</span><p>{employee.email || '-'}</p></div>
              <div className="col-span-2"><span className="text-xs text-gray-400">Contato de Emergência</span><p className={!(employee as { emergency_phone?: string }).emergency_phone ? 'text-amber-500 text-xs' : ''}>{(employee as { emergency_phone?: string }).emergency_phone || '⚠️ Não informado'}</p></div>
            </div>
          </div>

          {/* Endereço */}
          <div className="card p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Endereço</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="col-span-2">
                <span className="text-xs text-gray-400">Rua / Logradouro</span>
                <p>{[(employee as { address_street?: string }).address_street, (employee as { address_number?: string }).address_number].filter(Boolean).join(', ') || (employee.address as string) || '-'}</p>
              </div>
              <div><span className="text-xs text-gray-400">Bairro</span><p>{(employee as { address_neighborhood?: string }).address_neighborhood || '-'}</p></div>
              <div><span className="text-xs text-gray-400">Cidade</span><p>{(employee as { address_city?: string }).address_city || '-'}</p></div>
              <div><span className="text-xs text-gray-400">CEP</span><p className="font-mono">{(employee as { address_zip?: string }).address_zip || '-'}</p></div>
            </div>
          </div>

          {/* Dados Bancários */}
          <div className="card p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Dados Bancários</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-xs text-gray-400">Banco</span><p>{employee.bank_name || '-'}</p></div>
              <div><span className="text-xs text-gray-400">Agência</span><p className="font-mono">{employee.bank_agency || '-'}</p></div>
              <div><span className="text-xs text-gray-400">Conta Corrente</span><p className="font-mono">{employee.bank_account || '-'}</p></div>
              <div><span className="text-xs text-gray-400">Chave PIX</span><p className="font-mono text-xs break-all">{employee.pix || '-'}</p></div>
            </div>
          </div>

          {/* Documents */}
          <div className="card p-5">
            <h3 className="font-medium mb-3">Documentos</h3>
            {/* Hidden file input for doc uploads */}
            <input
              ref={docFileRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file && pendingDocUpload) uploadDocFile(pendingDocUpload, file)
                e.target.value = ''
              }}
            />
            <div className="space-y-2">
              {docs?.map(d => (
                <div key={d.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {DOC_ICON[d.status as DocStatus]}
                    <span className="text-sm truncate">{d.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {(d as { file_url?: string }).file_url ? (
                      <SignedLink value={(d as { file_url?: string }).file_url} bucket="arquivos" className="p-1 text-blue-600 hover:bg-blue-50 rounded">
                        <ExternalLink size={14} />
                      </SignedLink>
                    ) : null}
                    <button
                      className="p-1 text-gray-400 hover:text-primary-600 hover:bg-gray-100 rounded"
                      title="Enviar arquivo"
                      disabled={uploadingDocId === d.id}
                      onClick={() => { setPendingDocUpload(d.id); docFileRef.current?.click() }}
                    >
                      {uploadingDocId === d.id ? <span className="text-xs">...</span> : <Upload size={14} />}
                    </button>
                    <select
                      className="text-xs border rounded px-1.5 py-1"
                      value={d.status}
                      onChange={e => updateDoc.mutate({ docId: d.id, status: e.target.value as DocStatus })}
                    >
                      {DOC_STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <input className="input flex-1 text-sm" placeholder="Nome do documento..." value={newDocName} onChange={e => setNewDocName(e.target.value)} />
              <button className="btn-secondary text-sm" onClick={() => addDoc.mutate()} disabled={!newDocName}>Adicionar</button>
            </div>
          </div>
        </div>
      )}

      {/* VINCULOS */}
      {tab === 'vinculos' && (employee as { employee_type?: string }).employee_type === 'Volante' && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Coberturas</h3>
            <button className="btn-primary text-sm" onClick={() => setShowCoverageForm(v => !v)}>+ Nova cobertura</button>
          </div>

          {showCoverageForm && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
              <p className="text-sm font-medium text-orange-800">Nova cobertura</p>
              {/* Tipo */}
              <div>
                <label className="label">Tipo de cobertura *</label>
                <div className="flex gap-2">
                  {(['Fixo', 'Consultoria'] as const).map(t => (
                    <button key={t} type="button"
                      className={`flex-1 py-2 text-sm rounded-lg border font-medium transition-colors ${coverageForm.coverage_type === t ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-300 hover:border-orange-300'}`}
                      onClick={() => setCoverageForm(p => ({ ...p, coverage_type: t, unit_id: '', unit_ids: [] }))}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cliente */}
              <div>
                <label className="label">Cliente *</label>
                <select className="input" value={coverageForm.client_id}
                  onChange={e => setCoverageForm(p => ({ ...p, client_id: e.target.value, unit_id: '', unit_ids: [] }))}>
                  <option value="">Selecionar cliente...</option>
                  {clientsForCoverage?.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Unidade — Fixo: select único; Consultoria: lista com valor por unidade */}
              {coverageForm.client_id && coverageClientUnits && coverageClientUnits.length > 0 && (
                <div>
                  <label className="label">{coverageForm.coverage_type === 'Fixo' ? 'Unidade' : 'Unidades e valores'}</label>
                  {coverageForm.coverage_type === 'Fixo' ? (
                    <select className="input" value={coverageForm.unit_id}
                      onChange={e => setCoverageForm(p => ({ ...p, unit_id: e.target.value }))}>
                      <option value="">Selecionar unidade...</option>
                      {coverageClientUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  ) : (
                    <div className="space-y-2 border border-gray-200 rounded-lg p-2">
                      {coverageClientUnits.map(u => {
                        const cu = coverageForm.coverage_units.find(x => x.unit_id === u.id)
                        const checked = !!cu
                        return (
                          <div key={u.id} className="flex items-center gap-2">
                            <input type="checkbox" className="rounded shrink-0"
                              checked={checked}
                              onChange={e => {
                                if (e.target.checked) {
                                  setCoverageForm(p => ({ ...p, coverage_units: [...p.coverage_units, { unit_id: u.id, unit_name: u.name, visit_rate: '' }] }))
                                } else {
                                  setCoverageForm(p => ({ ...p, coverage_units: p.coverage_units.filter(x => x.unit_id !== u.id) }))
                                }
                              }} />
                            <span className="text-sm text-gray-700 flex-1">{u.name}</span>
                            {checked && (
                              <input type="number" step="0.01" placeholder="R$ valor/visita"
                                className="input py-1 text-sm w-36"
                                value={cu?.visit_rate || ''}
                                onChange={e => setCoverageForm(p => ({
                                  ...p,
                                  coverage_units: p.coverage_units.map(x => x.unit_id === u.id ? { ...x, visit_rate: e.target.value } : x)
                                }))} />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Campos Consultoria: frequência e horas */}
              {coverageForm.coverage_type === 'Consultoria' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Frequência</label>
                    <select className="input" value={coverageForm.visit_frequency}
                      onChange={e => setCoverageForm(p => ({ ...p, visit_frequency: e.target.value as 'Semanal' | 'Quinzenal' | 'Mensal' }))}>
                      <option value="Semanal">Semanal</option>
                      <option value="Quinzenal">Quinzenal</option>
                      <option value="Mensal">Mensal</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Horas por visita</label>
                    <input className="input" type="number" step="0.5" min="0.5" placeholder="Ex: 4"
                      value={coverageForm.weekly_hours_quota}
                      onChange={e => setCoverageForm(p => ({ ...p, weekly_hours_quota: e.target.value }))} />
                  </div>
                </div>
              )}

              {/* Campos de escala — somente Fixo */}
              {coverageForm.coverage_type === 'Fixo' && (
                <>
                  <div>
                    <label className="label">Escala *</label>
                    <select className="input" value={coverageForm.work_schedule_type}
                      onChange={e => setCoverageForm(p => ({ ...p, work_schedule_type: e.target.value, days_off: [], schedule_anchor_date: '' }))}>
                      <option value="">Selecionar escala...</option>
                      <option value="5x2">5×2 (5 dias / 2 folgas)</option>
                      <option value="6x1">6×1 (6 dias / 1 folga)</option>
                      <option value="12x36">12×36 (12h trabalho / 36h folga)</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Horas por dia *</label>
                    <input className="input" type="number" step="0.5" min="1" max="24" placeholder="Ex: 8"
                      value={coverageForm.daily_hours} onChange={e => setCoverageForm(p => ({ ...p, daily_hours: e.target.value }))} />
                  </div>
                  {coverageForm.work_schedule_type && coverageForm.work_schedule_type !== '12x36' && (
                    <div>
                      <label className="label">Dias de folga</label>
                      <div className="flex gap-1.5 flex-wrap">
                        {['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map((d, i) => (
                          <button key={i} type="button"
                            className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors ${coverageForm.days_off.includes(i) ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-300'}`}
                            onClick={() => setCoverageForm(p => ({ ...p, days_off: p.days_off.includes(i) ? p.days_off.filter(d => d !== i) : [...p.days_off, i] }))}>
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {coverageForm.work_schedule_type === '12x36' && (
                    <div>
                      <label className="label">Data âncora (primeiro dia de trabalho)</label>
                      <input className="input" type="date" value={coverageForm.schedule_anchor_date}
                        onChange={e => setCoverageForm(p => ({ ...p, schedule_anchor_date: e.target.value }))} />
                    </div>
                  )}
                </>
              )}

              {/* Datas e diária */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Data início *</label>
                  <input className="input" type="date" value={coverageForm.start_date} onChange={e => setCoverageForm(p => ({ ...p, start_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Data fim</label>
                  <input className="input" type="date" value={coverageForm.end_date} onChange={e => setCoverageForm(p => ({ ...p, end_date: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">Diária (R$) *</label>
                <input className="input" type="number" step="0.01" placeholder="Ex: 150.00" value={coverageForm.daily_rate} onChange={e => setCoverageForm(p => ({ ...p, daily_rate: e.target.value }))} />
              </div>
              <div className="flex gap-2">
                <button className="btn-primary text-sm" disabled={!coverageForm.client_id || !coverageForm.start_date || !coverageForm.daily_rate || addCoverage.isPending} onClick={() => addCoverage.mutate()}>Salvar cobertura</button>
                <button className="btn-secondary text-sm" onClick={() => setShowCoverageForm(false)}>Cancelar</button>
              </div>
            </div>
          )}

          {(links || []).filter(l => l.service_type === 'Volante').length === 0 && !showCoverageForm && (
            <p className="text-sm text-gray-400 text-center py-4">Nenhuma cobertura registrada. Clique em "Nova cobertura" para adicionar.</p>
          )}

          <div className="space-y-3">
            {(links || []).filter(l => l.service_type === 'Volante').map(l => {
              const startDate = (l as { start_date?: string }).start_date
              const endDate = (l as { contract_end_date?: string }).contract_end_date
              const dailyRate = (l as { daily_rate?: number }).daily_rate
              const coverageType = (l as { coverage_type?: string }).coverage_type
              const linkUnits = (l as { link_units?: { unit_id: string; unit_name: string }[] }).link_units || []
              const isExtending = extendLinkId === l.id
              const daysLeft = endDate ? differenceInDays(new Date(endDate + 'T12:00:00'), new Date()) : null
              const expired = daysLeft !== null && daysLeft < 0
              return (
                <div key={l.id} className={`border rounded-xl p-4 space-y-2 ${expired ? 'border-red-200 bg-red-50' : 'border-orange-200 bg-orange-50'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm">{(l as { client?: { name: string } }).client?.name || '—'}</p>
                        {coverageType && (
                          <span className={`badge text-xs ${coverageType === 'Fixo' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{coverageType}</span>
                        )}
                      </div>
                      {linkUnits.length > 0 && (
                        <p className="text-xs text-gray-500 mt-0.5">{linkUnits.map(u => u.unit_name).join(', ')}</p>
                      )}
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {startDate && <span className="badge bg-white text-gray-600">Início: {formatDate(startDate)}</span>}
                        {endDate && <span className={`badge ${expired ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                          {expired ? `Encerrado: ${formatDate(endDate)}` : `Até: ${formatDate(endDate)}`}
                        </span>}
                        {role === 'chefe' && dailyRate && <span className="badge bg-white text-gray-600">R$ {Number(dailyRate).toFixed(2)}/dia</span>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button className="text-xs text-primary-600 hover:underline px-2 py-1" onClick={() => { setExtendLinkId(isExtending ? null : l.id); setNewEndDate(endDate || '') }}>
                        {isExtending ? 'Cancelar' : 'Estender'}
                      </button>
                      <button className="text-xs text-red-400 hover:text-red-600 px-2 py-1"
                        onClick={() => { if (confirmRemoveLinkId === l.id) { removeLink.mutate(l.id); setConfirmRemoveLinkId(null) } else setConfirmRemoveLinkId(l.id) }}>
                        {confirmRemoveLinkId === l.id ? '⚠ Confirmar' : 'Remover'}
                      </button>
                    </div>
                  </div>
                  {isExtending && (
                    <div className="flex items-center gap-2 pt-2 border-t border-orange-200">
                      <label className="text-xs text-gray-600 font-medium">Nova data fim:</label>
                      <input type="date" className="input py-1 text-sm flex-1" value={newEndDate} onChange={e => setNewEndDate(e.target.value)} />
                      <button className="btn-primary text-xs py-1 px-3" disabled={!newEndDate || extendCoverage.isPending} onClick={() => extendCoverage.mutate({ linkId: l.id, endDate: newEndDate })}>Salvar</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'vinculos' && (employee as { employee_type?: string }).employee_type !== 'Volante' && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Clientes Vinculados</h3>
          </div>

          <p className="text-xs text-ink-500 bg-ink-50 rounded-xl px-3.5 py-2.5 leading-relaxed">
            Os vínculos com clientes são criados <strong>automaticamente</strong> ao contratar o colaborador em uma <strong>vaga</strong>. Para vincular este colaborador a um novo cliente, abra a vaga correspondente em <strong>Vagas</strong> e faça a contratação por lá.
          </p>

          <input ref={linkFileRef} type="file" accept=".pdf,.doc,.docx" className="hidden"
            onChange={async e => {
              const file = e.target.files?.[0]
              if (!file || !uploadingLinkId) return
              await uploadLinkContract(uploadingLinkId, file)
              e.target.value = ''
            }}
          />

          <div className="space-y-3">
            {links?.map(l => {
              const contractEnd = (l as { contract_end_date?: string }).contract_end_date
              const contractFile = (l as { contract_file_url?: string }).contract_file_url
              const linkCreated = (l as { created_at?: string }).created_at
              const contractPendingHours = !contractFile && (l.service_type === 'Fixo' || l.service_type === 'Consultoria') && linkCreated
                ? Math.floor((Date.now() - new Date(linkCreated).getTime()) / 3600000)
                : null
              const contractYellow = contractPendingHours !== null && contractPendingHours >= 24 && contractPendingHours < 48
              const contractRed = contractPendingHours !== null && contractPendingHours >= 48
              const daysLeft = contractEnd ? differenceInDays(new Date(contractEnd + 'T12:00:00'), new Date()) : null
              const expiringSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 40
              const expired = daysLeft !== null && daysLeft < 0
              return (
                <div key={l.id} className={`border rounded-lg p-4 ${contractRed ? 'border-red-300 bg-red-50 ring-1 ring-red-200' : contractYellow ? 'border-amber-300 bg-amber-50 ring-1 ring-amber-200' : expired ? 'border-red-200 bg-red-50' : expiringSoon ? 'border-amber-200 bg-amber-50' : 'border-gray-100'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{(l as { client?: { name: string } }).client?.name}</p>
                      <div className="flex gap-2 mt-1 flex-wrap items-center">
                        <span className={`badge ${l.service_type === 'Consultoria' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{l.service_type}</span>
                        {l.monthly_amount && role === 'chefe' && <span className="badge bg-gray-100 text-gray-600">{formatCurrency(l.monthly_amount)}/mês{l.service_type === 'Consultoria' ? ' (est.)' : ''}</span>}
                        {(l as { cost_assistance?: number }).cost_assistance ? <span className="badge bg-blue-50 text-blue-600">+{formatCurrency((l as { cost_assistance?: number }).cost_assistance!)} aj.custo</span> : null}
                        {l.weekly_hours_quota && <span className="badge bg-gray-100 text-gray-600">{l.weekly_hours_quota}h/visita</span>}
                        {(l as { visit_frequency?: string }).visit_frequency && l.service_type === 'Consultoria' && <span className="badge bg-orange-50 text-orange-600">{(l as { visit_frequency?: string }).visit_frequency}</span>}
                        {(l as { work_schedule_type?: string }).work_schedule_type && <span className="badge bg-gray-100 text-gray-600">{(l as { work_schedule_type?: string }).work_schedule_type}</span>}
                        {(l as { start_date?: string }).start_date && <span className="badge bg-green-50 text-green-700">Início: {formatDate((l as { start_date?: string }).start_date!)}</span>}
                        {(l as { pay_full_salary?: boolean }).pay_full_salary && <span className="badge bg-purple-50 text-purple-700">Salário inteiro</span>}
                        {contractPendingHours !== null && (
                          <span className={`badge text-xs font-semibold ${contractRed ? 'bg-red-100 text-red-700 animate-pulse' : contractYellow ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                            {contractRed
                              ? `⚠ Contrato URGENTE — anexar (${contractPendingHours}h atrás)`
                              : contractYellow
                              ? `⏳ Contrato pendente — anexar (${contractPendingHours}h atrás)`
                              : `📎 Anexar contrato (${contractPendingHours}h)`}
                          </span>
                        )}
                        {contractFile && (
                          <span className="badge bg-green-100 text-green-700">✓ Contrato anexado</span>
                        )}
                        {(l as { visits_per_week?: number }).visits_per_week ? (
                          <span className="badge bg-orange-50 text-orange-600">
                            {(l as { visits_per_week?: number }).visits_per_week} visita(s)/sem
                          </span>
                        ) : null}
                        {daysLeft !== null ? (
                          <span className={`badge text-xs ${expired ? 'bg-red-100 text-red-700' : expiringSoon ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                            {expired ? `Contrato vencido há ${Math.abs(daysLeft)}d` : daysLeft === 0 ? 'Vence hoje!' : `Contrato: ${daysLeft}d restantes`}
                          </span>
                        ) : !contractEnd && (l.service_type === 'Fixo' || l.service_type === 'Consultoria') ? (
                          <span className="badge text-xs bg-gray-100 text-gray-500">Contrato indeterminado</span>
                        ) : null}
                        <button
                          className="text-xs text-primary-600 hover:underline flex items-center gap-0.5 ml-1"
                          onClick={() => {
                            const existing = ((l as { link_units?: { unit_id: string; unit_name: string; visit_rate?: number }[] }).link_units) || []
                            const clientId = (l as { client?: { id: string } }).client?.id || ''
                            setEditLinkValues({
                              linkId: l.id,
                              serviceType: l.service_type,
                              clientId,
                              monthly_amount: String(l.monthly_amount || ''),
                              cost_assistance: String((l as { cost_assistance?: number }).cost_assistance || ''),
                              weekly_hours: String(l.weekly_hours_quota || ''),
                              visit_frequency: (l as { visit_frequency?: string }).visit_frequency || 'Semanal',
                              visits_per_week: String((l as { visits_per_week?: number }).visits_per_week || ''),
                              pay_extra_visits: (l as { pay_extra_visits?: boolean }).pay_extra_visits !== false,
                              units: existing.map(u => ({ unit_id: u.unit_id, unit_name: u.unit_name, visit_rate: u.visit_rate != null ? String(u.visit_rate) : '' })),
                              work_schedule_type: (l as { work_schedule_type?: string }).work_schedule_type || '',
                              daily_hours: String((l as { daily_hours?: number }).daily_hours || ''),
                              days_off: ((l as { days_off?: number[] }).days_off) || [],
                              schedule_anchor_date: (l as { schedule_anchor_date?: string }).schedule_anchor_date || '',
                              start_date: (l as { start_date?: string }).start_date || '',
                              payDays: l.service_type === 'Consultoria' ? ['8', '20'] : (l.payment_dates || []).map(d => String(d.day_of_month)).filter(d => ['8', '15', '20'].includes(d)).sort((a, b) => Number(a) - Number(b)),
                              pay_full_salary: (l as { pay_full_salary?: boolean }).pay_full_salary ?? false,
                            })
                          }}
                        >
                          ✏️ Editar
                        </button>
                      </div>

                      {/* Inline edit */}
                      {editLinkValues?.linkId === l.id && (() => {
                        const isConsult = editLinkValues.serviceType === 'Consultoria'
                        const ratedUnits = isConsult ? editLinkValues.units.filter(u => u.visit_rate) : []
                        const avgRate = ratedUnits.length ? ratedUnits.reduce((s, u) => s + Number(u.visit_rate), 0) / ratedUnits.length : 0
                        const consultTotal = avgRate * 4
                        const fixoTotal = !isConsult ? (Number(editLinkValues.monthly_amount) || 0) + (Number(editLinkValues.cost_assistance) || 0) : 0

                        return (
                          <div className={`mt-3 p-3 rounded-lg space-y-3 border ${isConsult ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200'}`}>
                            <p className={`text-xs font-semibold ${isConsult ? 'text-orange-700' : 'text-blue-700'}`}>
                              {isConsult ? 'Consultoria — Unidades & Valores' : 'Editar valores'}
                            </p>

                            {isConsult ? (
                              <>
                                {/* Frequência + Horas por visita */}
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="label text-xs">Frequência</label>
                                    <select className="input text-sm" value={editLinkValues.visit_frequency}
                                      onChange={e => setEditLinkValues(p => p ? { ...p, visit_frequency: e.target.value } : p)}>
                                      <option value="Semanal">Semanal (4×/mês)</option>
                                      <option value="Quinzenal">Quinzenal (2×/mês)</option>
                                      <option value="Mensal">Mensal (1×/mês)</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="label text-xs">Horas por visita</label>
                                    <input className="input text-sm" type="number" placeholder="Ex: 4"
                                      value={editLinkValues.weekly_hours}
                                      onChange={e => setEditLinkValues(p => p ? { ...p, weekly_hours: e.target.value } : p)} />
                                  </div>
                                  <div>
                                    <label className="label text-xs">Horas/mês — automático</label>
                                    <div className="input text-sm bg-white/60 text-gray-600 flex items-center">
                                      {editLinkValues.weekly_hours ? `${Number(editLinkValues.weekly_hours) * (editLinkValues.visit_frequency === 'Mensal' ? 1 : editLinkValues.visit_frequency === 'Quinzenal' ? 2 : 4)}h` : '—'}
                                    </div>
                                  </div>
                                </div>

                                {/* Unidades — cada uma com o valor da vistoria dela */}
                                <div className="space-y-2">
                                  <label className="label text-xs">Unidades e valor da vistoria</label>
                                  {(editClientUnits || []).map(unit => {
                                    const row = editLinkValues.units.find(u => u.unit_id === unit.id)
                                    const isActive = !!row
                                    return (
                                      <div key={unit.id} className={`rounded-lg border px-3 py-2 flex items-center gap-3 ${isActive ? 'border-orange-400 bg-white' : 'border-gray-200 bg-gray-50'}`}>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (isActive) {
                                              setEditLinkValues(p => p ? { ...p, units: p.units.filter(u => u.unit_id !== unit.id) } : p)
                                            } else {
                                              setEditLinkValues(p => p ? { ...p, units: [...p.units, { unit_id: unit.id, unit_name: unit.name, visit_rate: '' }] } : p)
                                            }
                                          }}
                                          className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${isActive ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}
                                        >
                                          {isActive ? '−' : '+'}
                                        </button>
                                        <span className="flex-1 text-sm font-medium text-gray-800">{unit.name}</span>
                                        {isActive && (
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-xs text-gray-500">Vistoria R$</span>
                                            <input className="input text-sm w-24" type="number" placeholder="0,00"
                                              value={row!.visit_rate}
                                              onChange={e => setEditLinkValues(p => p ? { ...p, units: p.units.map(u => u.unit_id === unit.id ? { ...u, visit_rate: e.target.value } : u) } : p)}
                                            />
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                  {(editClientUnits || []).length === 0 && (
                                    <p className="text-xs text-orange-500 italic">Este cliente não tem unidades cadastradas. Cadastre em Clientes → Unidades.</p>
                                  )}
                                </div>

                                {/* Combinado de pagamento = horas no mês (definidas acima). Visitas em si são livres. */}
                                <div className="border-t border-orange-200 pt-2 space-y-2">
                                  <p className="text-xs text-orange-600">
                                    {editLinkValues.weekly_hours
                                      ? `Combinado: ${Number(editLinkValues.weekly_hours) * 4}h no mês. Se ela passar disso em +1h, o excedente vai pra sua aprovação em Visitas → Consultoria.`
                                      : 'Sem combinado de horas — toda visita registrada é paga pela fórmula.'}
                                  </p>
                                  <div>
                                    <label className="label text-xs">Meta de visitas/semana <span className="text-gray-400 font-normal">— opcional, só referência</span></label>
                                    <input className="input text-sm" type="number" min={1} placeholder="Livre"
                                      value={editLinkValues.visits_per_week}
                                      onChange={e => setEditLinkValues(p => p ? { ...p, visits_per_week: e.target.value } : p)} />
                                  </div>
                                </div>

                                {consultTotal > 0 && (
                                  <div className="bg-orange-100 rounded-lg px-3 py-2 text-sm font-semibold text-orange-800">
                                    Estimativa mensal: R$ {consultTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    <span className="text-xs font-normal text-orange-600 ml-1">(média das unidades R$ {avgRate.toFixed(2)} × 4 semanas — o pagamento real é pelas horas da folha de ponto)</span>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="label text-xs">Salário Mensal (R$)</label>
                                  <input className="input" type="number" value={editLinkValues.monthly_amount}
                                    onChange={e => setEditLinkValues(p => p ? { ...p, monthly_amount: e.target.value } : p)} />
                                </div>
                                <div>
                                  <label className="label text-xs">Ajuda de Custo (R$)</label>
                                  <input className="input" type="number" placeholder="0,00" value={editLinkValues.cost_assistance}
                                    onChange={e => setEditLinkValues(p => p ? { ...p, cost_assistance: e.target.value } : p)} />
                                </div>
                                {fixoTotal > 0 && (
                                  <div className="col-span-2 text-xs text-blue-700 font-medium">
                                    Total: R$ {fixoTotal.toFixed(2)}/mês
                                  </div>
                                )}

                                {/* Escala — sem ela o portal não cobra os dias nem calcula hora extra */}
                                <div>
                                  <label className="label text-xs">Escala de trabalho</label>
                                  <select className="input text-sm" value={editLinkValues.work_schedule_type}
                                    onChange={e => setEditLinkValues(p => p ? { ...p, work_schedule_type: e.target.value, days_off: [], schedule_anchor_date: '' } : p)}>
                                    <option value="">Selecionar...</option>
                                    <option value="5x2">5x2</option>
                                    <option value="6x1">6x1</option>
                                    <option value="12x36">12x36</option>
                                    <option value="Plantão">Plantão</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="label text-xs">Horas por dia</label>
                                  <input className="input text-sm" type="number" min={1} max={24} placeholder="Ex: 8" value={editLinkValues.daily_hours}
                                    onChange={e => setEditLinkValues(p => p ? { ...p, daily_hours: e.target.value } : p)} />
                                </div>
                                {(editLinkValues.work_schedule_type === '5x2' || editLinkValues.work_schedule_type === '6x1') && (() => {
                                  const maxOff = editLinkValues.work_schedule_type === '5x2' ? 2 : 1
                                  const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
                                  return (
                                    <div className="col-span-2">
                                      <label className="label text-xs">Dia(s) de folga — escolha {maxOff}</label>
                                      <div className="flex gap-1.5 flex-wrap mt-1">
                                        {DAYS.map((name, idx) => {
                                          const sel = editLinkValues.days_off.includes(idx)
                                          const dis = !sel && editLinkValues.days_off.length >= maxOff
                                          return (
                                            <button key={idx} type="button" disabled={dis}
                                              onClick={() => setEditLinkValues(p => p ? { ...p, days_off: sel ? p.days_off.filter(x => x !== idx) : [...p.days_off, idx] } : p)}
                                              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${sel ? 'bg-blue-600 text-white border-blue-600' : dis ? 'bg-gray-50 text-gray-300 border-gray-200' : 'bg-white text-gray-700 border-gray-300'}`}>
                                              {name}
                                            </button>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )
                                })()}
                                {editLinkValues.work_schedule_type === '12x36' && (
                                  <div className="col-span-2">
                                    <label className="label text-xs">Primeiro dia de trabalho da escala 12x36</label>
                                    <input className="input text-sm" type="date" value={editLinkValues.schedule_anchor_date}
                                      onChange={e => setEditLinkValues(p => p ? { ...p, schedule_anchor_date: e.target.value } : p)} />
                                  </div>
                                )}
                                <div className="col-span-2">
                                  <label className="label text-xs">Data de início neste cliente</label>
                                  <input className="input text-sm" type="date" value={editLinkValues.start_date}
                                    onChange={e => setEditLinkValues(p => p ? { ...p, start_date: e.target.value } : p)} />
                                  <p className="text-xs text-gray-400 mt-0.5">Usado para calcular ciclo proporcional no pagamento.</p>
                                </div>
                                <div className="col-span-2">
                                  <label className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={editLinkValues.pay_full_salary}
                                      onChange={e => setEditLinkValues(p => p ? { ...p, pay_full_salary: e.target.checked } : p)}
                                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                    />
                                    <span className="text-sm text-gray-700">Pagar salário inteiro</span>
                                  </label>
                                  <p className="text-xs text-gray-400 mt-0.5 ml-6">Ignora cálculo proporcional do ciclo de pagamento.</p>
                                </div>
                              </div>
                            )}

                            {/* Cost assistance for Consultoria */}
                            {isConsult && (
                              <div>
                                <label className="label text-xs">Ajuda de Custo (R$) — opcional</label>
                                <input className="input" type="number" placeholder="0,00" value={editLinkValues.cost_assistance}
                                  onChange={e => setEditLinkValues(p => p ? { ...p, cost_assistance: e.target.value } : p)} />
                              </div>
                            )}

                            {/* Datas de pagamento — dia 8, 15 e 20 */}
                            <div className="border-t pt-2 space-y-2">
                              <div className="flex items-center justify-between">
                                <label className="label text-xs mb-0">Dias de pagamento</label>
                                {(() => {
                                  const n = editLinkValues.payDays.length
                                  const total = isConsult ? consultTotal : Number(editLinkValues.monthly_amount) || 0
                                  return n > 0 && total > 0 ? (
                                    <span className="text-xs text-gray-500">{n === 1 ? 'valor inteiro' : `R$ ${(total / n).toFixed(2)} em cada`}</span>
                                  ) : null
                                })()}
                              </div>
                              {isConsult ? (
                                <div className="bg-orange-50 rounded-lg px-3 py-2 text-xs text-orange-700">
                                  Consultoria: pagamento quinzenal nos dias <strong>8</strong> e <strong>20</strong> (automático).
                                </div>
                              ) : (
                                <div className="flex gap-3">
                                  {[8, 15, 20].map(day => {
                                    const checked = editLinkValues.payDays.includes(String(day))
                                    return (
                                      <label key={day} className="flex items-center gap-1.5 cursor-pointer">
                                        <input type="checkbox" className="rounded" checked={checked}
                                          onChange={e => setEditLinkValues(p => {
                                            if (!p) return p
                                            const days = e.target.checked
                                              ? [...p.payDays, String(day)].sort((a, b) => Number(a) - Number(b))
                                              : p.payDays.filter(d => d !== String(day))
                                            return { ...p, payDays: days }
                                          })} />
                                        <span className="text-sm font-medium">Dia {day}</span>
                                      </label>
                                    )
                                  })}
                                </div>
                              )}
                              {!isConsult && editLinkValues.payDays.length === 0 && (
                                <p className="text-xs text-amber-600">Selecione pelo menos um dia de pagamento.</p>
                              )}
                            </div>

                            <div className="flex gap-2">
                              <button className="btn-primary text-xs" onClick={() => updateLinkValues.mutate(editLinkValues)} disabled={updateLinkValues.isPending}>
                                {updateLinkValues.isPending ? 'Salvando...' : 'Salvar'}
                              </button>
                              <button className="btn-secondary text-xs" onClick={() => setEditLinkValues(null)}>Cancelar</button>
                            </div>
                          </div>
                        )
                      })()}
                      {l.payment_dates?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {l.payment_dates.map(d => (
                            <span key={d.id} className="px-2 py-0.5 bg-primary-50 text-primary-700 rounded-full text-xs">
                              Dia {d.day_of_month}{d.amount ? ` — ${formatCurrency(d.amount)}` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {editContractDate?.linkId === l.id ? (
                          <div className="flex items-center gap-2">
                            <input type="date" className="input input-sm text-xs py-0.5 px-2 h-7" value={editContractDate.date}
                              onChange={e => setEditContractDate({ linkId: l.id, date: e.target.value })} />
                            <button className="btn-primary text-xs py-0.5 px-2 h-7" onClick={() => saveContractEndDate(l.id, editContractDate.date)}>OK</button>
                            <button className="btn-secondary text-xs py-0.5 px-2 h-7" onClick={() => setEditContractDate(null)}>×</button>
                          </div>
                        ) : (
                          <button className="text-xs text-primary-600 hover:underline"
                            onClick={() => setEditContractDate({ linkId: l.id, date: contractEnd || '' })}>
                            {contractEnd ? `Vence ${formatDate(contractEnd)}` : '+ Definir vencimento'}
                          </button>
                        )}
                      </div>

                      {/* Check-in do contrato assinado — anexar o PDF confirma o processo e alimenta a pizza do Dashboard */}
                      {(l.service_type === 'Fixo' || l.service_type === 'Consultoria') && (
                        <div className={`mt-2 rounded-xl border px-3 py-2.5 flex items-center gap-3 ${contractFile ? 'border-green-200 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
                          {contractFile ? (
                            <>
                              <CheckCircle size={18} className="text-green-600 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-green-800">Contrato assinado anexado ✓</p>
                                <SignedLink value={contractFile} bucket="arquivos" className="text-xs text-green-700 hover:underline flex items-center gap-1">
                                  <ExternalLink size={10} /> Ver contrato
                                </SignedLink>
                              </div>
                              <button onClick={() => { setUploadingLinkId(l.id); setTimeout(() => linkFileRef.current?.click(), 50) }}
                                className="btn-secondary text-xs shrink-0" disabled={uploadingLinkId === l.id}>
                                <Upload size={12} /> {uploadingLinkId === l.id ? 'Enviando...' : 'Trocar'}
                              </button>
                            </>
                          ) : (
                            <>
                              <AlertTriangle size={18} className="text-amber-600 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-amber-800">Contrato assinado pendente</p>
                                <p className="text-xs text-amber-600">Anexe o PDF do contrato assinado para dar o check-in.</p>
                              </div>
                              <button onClick={() => { setUploadingLinkId(l.id); setTimeout(() => linkFileRef.current?.click(), 50) }}
                                className="btn-primary text-xs shrink-0 bg-amber-600 hover:bg-amber-700" disabled={uploadingLinkId === l.id}>
                                <Upload size={12} /> {uploadingLinkId === l.id ? 'Enviando...' : 'Anexar contrato'}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 ml-2 shrink-0">
                      {confirmRemoveLinkId === l.id ? (
                        <>
                          <button
                            onClick={() => { removeLink.mutate(l.id); setConfirmRemoveLinkId(null) }}
                            className="text-xs bg-red-600 text-white px-2 py-1 rounded font-medium hover:bg-red-700"
                          >
                            Confirmar remoção
                          </button>
                          <button onClick={() => setConfirmRemoveLinkId(null)} className="text-xs text-gray-400 hover:text-gray-600">
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmRemoveLinkId(l.id)}
                          className="text-red-400 hover:text-red-600 p-1"
                          title="Remover vínculo"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {links?.length === 0 && <p className="text-sm text-gray-400">Nenhum vínculo cadastrado</p>}
          </div>
        </div>
      )}

      {/* PAGAMENTOS (somente chefe) */}
      {tab === 'pagamentos' && role === 'chefe' && (
        <div className="space-y-4">
        <FolhaResumo employeeId={id!} employeeName={(employee as { full_name?: string })?.full_name || ''} links={links || []} payMonth={payMonth} onMonthChange={setPayMonth} />
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input className="input w-40" type="month" value={payMonth} onChange={e => setPayMonth(e.target.value)} />
            <button className="btn-primary text-sm" onClick={() => generatePayChecks.mutate()}>Gerar Checklist</button>
            <p className="text-sm text-gray-500">{paidCount}/{totalCount} pagos — Total: {formatCurrency(totalAmount)}</p>
          </div>
          <div className="space-y-2">
            {payChecks?.map(c => (
              <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100">
                <div>
                  <p className="text-sm">Dia {c.payment_date?.day_of_month}</p>
                  {c.payment_date?.amount && <p className="text-xs text-gray-500">{formatCurrency(c.payment_date.amount)}</p>}
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={c.paid} onChange={e => togglePaid.mutate({ checkId: c.id, paid: e.target.checked })} className="rounded" />
                  <span className={`text-sm font-medium ${c.paid ? 'text-green-600' : 'text-amber-600'}`}>{c.paid ? 'Pago' : 'Pendente'}</span>
                </label>
              </div>
            ))}
            {payChecks?.length === 0 && <p className="text-sm text-gray-400">Clique em "Gerar Checklist" para criar os registros do mês</p>}
          </div>

          {/* ── Gastos / Reembolsos ── */}
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-sm">Gastos & Reembolsos</h3>
                <p className="text-xs text-gray-400">Extras além do salário — reembolsos, ajuda de custo, etc.</p>
              </div>
              <button className="btn-secondary text-sm flex items-center gap-1" onClick={() => setShowExpForm(p => !p)}>
                <Plus size={14} /> Novo Gasto
              </button>
            </div>

            {/* Hidden receipt input */}
            <input
              ref={expReceiptRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file && pendingExpUpload) uploadExpReceipt(pendingExpUpload, file)
                e.target.value = ''
              }}
            />

            {showExpForm && (
              <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                <input className="input text-sm w-full" placeholder="Descrição *" value={expForm.description} onChange={e => setExpForm(p => ({ ...p, description: e.target.value }))} />
                <div className="grid grid-cols-2 gap-2">
                  <input className="input text-sm" type="number" placeholder="Valor R$ *" value={expForm.amount} onChange={e => setExpForm(p => ({ ...p, amount: e.target.value }))} />
                  <select className="input text-sm" value={expForm.category} onChange={e => setExpForm(p => ({ ...p, category: e.target.value }))}>
                    <option>Reembolso</option>
                    <option>Ajuda de Custo</option>
                    <option>Vale Transporte</option>
                    <option>Alimentação</option>
                    <option>Material</option>
                    <option>Outro</option>
                  </select>
                </div>
                <input className="input text-sm w-full" placeholder="Observação (opcional)" value={expForm.notes} onChange={e => setExpForm(p => ({ ...p, notes: e.target.value }))} />
                <div className="flex gap-2">
                  <button
                    className="btn-primary text-sm flex-1"
                    onClick={() => addExpense.mutate()}
                    disabled={addExpense.isPending || !expForm.description || !expForm.amount}
                  >
                    {addExpense.isPending ? 'Salvando...' : 'Registrar'}
                  </button>
                  <button className="btn-ghost text-sm" onClick={() => setShowExpForm(false)}>Cancelar</button>
                </div>
              </div>
            )}

            {expenses && expenses.length > 0 ? (
              <div className="space-y-2">
                {expenses.map(exp => (
                  <div key={exp.id} className="flex items-center justify-between p-3 bg-orange-50 rounded-lg gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{exp.description}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{exp.category}</span>
                        {exp.notes && <span className="text-xs text-gray-400">· {exp.notes}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-semibold text-orange-800">R$ {Number(exp.amount).toFixed(2)}</span>
                      {(exp as { receipt_url?: string }).receipt_url ? (
                        <SignedLink value={(exp as { receipt_url?: string }).receipt_url} bucket="arquivos">
                          <ExternalLink size={14} className="text-blue-500" />
                        </SignedLink>
                      ) : (
                        <button
                          className="text-xs text-primary-600 flex items-center gap-1 underline"
                          disabled={uploadingExpId === exp.id}
                          onClick={() => { setPendingExpUpload(exp.id); expReceiptRef.current?.click() }}
                        >
                          <Upload size={12} /> {uploadingExpId === exp.id ? '...' : 'comprovante'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <div className="text-right text-sm font-semibold text-orange-800 pt-1">
                  Total gastos: R$ {expenses.reduce((s, e) => s + Number(e.amount), 0).toFixed(2)}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Nenhum gasto registrado em {payMonth}.</p>
            )}
          </div>
        </div>
        </div>
      )}

      {/* AGENDA */}
      {tab === 'agenda' && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-medium">Agenda de Visitas</h3>
            <div className="flex items-center gap-2">
              <input type="month" className="input text-sm py-1" value={agendaMonth} onChange={e => setAgendaMonth(e.target.value)} />
              <button onClick={() => setShowAgendaForm(true)} className="btn-secondary text-sm flex items-center gap-1"><Plus size={14} />Adicionar data</button>
              <button
                className="btn-secondary text-sm flex items-center gap-1"
                onClick={() => {
                  const rows = (agendaItems || []).map((a: { planned_date: string; client?: { name?: string }; unit?: { name?: string }; notes?: string }) =>
                    `<tr><td>${formatDate(a.planned_date)}</td><td>${a.client?.name || '-'}</td><td>${a.unit?.name || '-'}</td><td>${a.notes || ''}</td></tr>`
                  ).join('')
                  const w = window.open('', '_blank')!
                  w.document.write(`<html><head><title>Agenda ${agendaMonth}</title><style>body{font-family:Arial;padding:24px}table{width:100%;border-collapse:collapse;margin-top:12px}th{background:#f3f4f6;padding:8px;text-align:left;font-size:12px;border-bottom:2px solid #e5e7eb}td{padding:8px;border-bottom:1px solid #f3f4f6;font-size:13px}h2{margin:0 0 4px}p{margin:0 0 12px;color:#6b7280;font-size:13px}</style></head><body><h2>${employee?.full_name} — Agenda ${agendaMonth}</h2><p>Planejamento de visitas</p><table><thead><tr><th>Data</th><th>Cliente</th><th>Unidade</th><th>Obs.</th></tr></thead><tbody>${rows || '<tr><td colspan="4" style="color:#aaa">Nenhuma data agendada</td></tr>'}</tbody></table></body></html>`)
                  w.document.close(); w.print()
                }}
              ><Download size={14} />PDF</button>
            </div>
          </div>

          {showAgendaForm && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 space-y-3">
              <p className="text-sm font-medium text-orange-800">Nova data na agenda</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Data *</label>
                  <input type="date" className="input" value={agendaForm.planned_date} onChange={e => setAgendaForm(p => ({ ...p, planned_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Cliente *</label>
                  <select className="input" value={agendaForm.client_id} onChange={e => setAgendaForm(p => ({ ...p, client_id: e.target.value, unit_id: '' }))}>
                    <option value="">Selecionar...</option>
                    {links?.filter(l => l.service_type === 'Consultoria').map(l => (
                      <option key={l.id} value={(l.client as { id: string; name: string }).id}>{(l.client as { id: string; name: string }).name}</option>
                    ))}
                  </select>
                </div>
                {agendaClientUnits && agendaClientUnits.length > 0 && (
                  <div>
                    <label className="label">Unidade</label>
                    <select className="input" value={agendaForm.unit_id} onChange={e => setAgendaForm(p => ({ ...p, unit_id: e.target.value }))}>
                      <option value="">Todas</option>
                      {agendaClientUnits.map((u: { id: string; name: string }) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="label">Horas esperadas <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <input className="input" type="number" min={0.5} step="0.5" placeholder="Ex: 4" value={agendaForm.hours_expected} onChange={e => setAgendaForm(p => ({ ...p, hours_expected: e.target.value }))} />
                </div>
                <div className={agendaClientUnits && agendaClientUnits.length > 0 ? 'col-span-2' : 'col-span-2'}>
                  <label className="label">Obs. (opcional)</label>
                  <input className="input" value={agendaForm.notes} onChange={e => setAgendaForm(p => ({ ...p, notes: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-primary text-sm" onClick={() => addAgendaItem.mutate()} disabled={!agendaForm.planned_date || !agendaForm.client_id || addAgendaItem.isPending}>Salvar</button>
                <button className="btn-secondary text-sm" onClick={() => { setShowAgendaForm(false); setAgendaForm({ client_id: '', unit_id: '', planned_date: '', notes: '', hours_expected: '' }) }}>Cancelar</button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {agendaItems?.length === 0 && <p className="text-sm text-gray-400">Nenhuma data agendada para este mês.</p>}
            {(agendaItems || []).map((a: { id: string; planned_date: string; client?: { name?: string }; unit?: { name?: string }; notes?: string; rescheduled_at?: string; original_date?: string; hours_expected?: number; created_by_admin?: boolean }) => (
              <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border border-orange-100 bg-orange-50/40 gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-wrap">
                  <span className="text-sm font-semibold text-orange-700 whitespace-nowrap">{formatDate(a.planned_date)}</span>
                  <span className="text-sm text-gray-700">{a.client?.name || '-'}</span>
                  {a.unit?.name && <span className="text-xs text-gray-400">· {a.unit.name}</span>}
                  {a.hours_expected && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">{a.hours_expected}h</span>}
                  {a.notes && <span className="text-xs text-gray-500 italic truncate">"{a.notes}"</span>}
                  {a.rescheduled_at && <span className="text-xs text-amber-600">Remarcado</span>}
                  {a.created_by_admin && <span className="text-xs text-blue-500">🔒 fixo</span>}
                </div>
                <button onClick={() => deleteAgendaItem.mutate(a.id)} className="p-1 text-gray-300 hover:text-red-500 rounded shrink-0"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VISITAS REALIZADAS */}
      {tab === 'visitas' && (() => {
        const durMin = (a?: string, b?: string) => {
          if (!a || !b) return 0
          const [h1, m1] = a.slice(0,5).split(':').map(Number)
          const [h2, m2] = b.slice(0,5).split(':').map(Number)
          return Math.max(0, (h2*60+m2)-(h1*60+m1))
        }
        const fmtH = (m: number) => `${Math.floor(m/60)}h${m%60>0?m%60+'min':''}`
        const visits = (visitHistory || []) as { id: string; visit_date: string; client?: { name?: string }; unit_name?: string; check_in?: string; check_out?: string; break_start?: string; break_end?: string; visit_rate?: number; is_unavailable?: boolean; unavailability_reason?: string; observations?: string }[]
        const realized = visits.filter(v => !v.is_unavailable && v.check_in && v.check_out)
        const totalMin = realized.reduce((s, v) => s + Math.max(0, durMin(v.check_in, v.check_out) - durMin(v.break_start, v.break_end)), 0)
        const totalVal = realized.reduce((s, v) => s + (Number(v.visit_rate) || 0), 0)

        return (
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-medium">Visitas Realizadas</h3>
              <div className="flex items-center gap-2">
                <input type="month" className="input text-sm py-1" value={visMonth} onChange={e => setVisMonth(e.target.value)} />
                <button
                  className="btn-secondary text-sm flex items-center gap-1"
                  onClick={() => {
                    const rows = realized.map(v => {
                      const net = Math.max(0, durMin(v.check_in, v.check_out) - durMin(v.break_start, v.break_end))
                      return `<tr><td>${formatDate(v.visit_date)}</td><td>${v.client?.name||'-'}</td><td>${v.unit_name||'-'}</td><td>${v.check_in?.slice(0,5)||'-'}</td><td>${v.check_out?.slice(0,5)||'-'}</td><td>${fmtH(net)}</td><td>${v.visit_rate?'R$ '+Number(v.visit_rate).toFixed(2):'-'}</td></tr>`
                    }).join('')
                    const w = window.open('', '_blank')!
                    w.document.write(`<html><head><title>Visitas ${visMonth}</title><style>body{font-family:Arial;padding:24px}table{width:100%;border-collapse:collapse;margin-top:12px}th{background:#f3f4f6;padding:8px;text-align:left;font-size:11px;text-transform:uppercase;border-bottom:2px solid #e5e7eb}td{padding:8px;border-bottom:1px solid #f3f4f6;font-size:12px}tfoot td{font-weight:bold;background:#f9fafb}h2{margin:0 0 4px}p{margin:0 0 12px;color:#6b7280;font-size:13px}</style></head><body><h2>${employee?.full_name} — Visitas ${visMonth}</h2><p>${realized.length} visita(s) · Total: ${fmtH(totalMin)} · R$ ${totalVal.toFixed(2)}</p><table><thead><tr><th>Data</th><th>Cliente</th><th>Unidade</th><th>Entrada</th><th>Saída</th><th>Duração</th><th>Valor</th></tr></thead><tbody>${rows||'<tr><td colspan="7" style="color:#aaa">Nenhuma visita</td></tr>'}</tbody><tfoot><tr><td colspan="5">Total</td><td>${fmtH(totalMin)}</td><td>R$ ${totalVal.toFixed(2)}</td></tr></tfoot></table></body></html>`)
                    w.document.close(); w.print()
                  }}
                ><Download size={14} />PDF</button>
              </div>
            </div>

            {visits.length === 0 && <p className="text-sm text-gray-400">Nenhum registro neste mês.</p>}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-xs text-gray-400 font-medium">Data</th>
                    <th className="text-left py-2 px-2 text-xs text-gray-400 font-medium">Cliente</th>
                    <th className="text-left py-2 px-2 text-xs text-gray-400 font-medium">Unidade</th>
                    <th className="text-left py-2 px-2 text-xs text-gray-400 font-medium">Entrada</th>
                    <th className="text-left py-2 px-2 text-xs text-gray-400 font-medium">Saída</th>
                    <th className="text-left py-2 px-2 text-xs text-gray-400 font-medium">Duração</th>
                    <th className="text-left py-2 px-2 text-xs text-gray-400 font-medium">Valor</th>
                    <th className="py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map(v => {
                    if (v.is_unavailable) return (
                      <tr key={v.id} className="border-b border-gray-50">
                        <td className="py-2 px-2 text-gray-500">{formatDate(v.visit_date)}</td>
                        <td className="py-2 px-2 text-gray-400" colSpan={7}>Falta — {v.unavailability_reason || 'sem motivo'}</td>
                      </tr>
                    )
                    const net = Math.max(0, durMin(v.check_in, v.check_out) - durMin(v.break_start, v.break_end))
                    const isEditing = editVisitId === v.id
                    return (
                      <>
                        <tr key={v.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="py-2 px-2">{formatDate(v.visit_date)}</td>
                          <td className="py-2 px-2">{v.client?.name || '-'}</td>
                          <td className="py-2 px-2 text-gray-500">{v.unit_name || '-'}</td>
                          <td className="py-2 px-2 font-mono">{v.check_in?.slice(0,5) || '-'}</td>
                          <td className="py-2 px-2 font-mono">{v.check_out?.slice(0,5) || '-'}</td>
                          <td className="py-2 px-2">{v.check_in && v.check_out ? fmtH(net) : '-'}</td>
                          <td className="py-2 px-2">{v.visit_rate ? `R$ ${Number(v.visit_rate).toFixed(2)}` : '-'}</td>
                          <td className="py-2 px-2">
                            <button
                              className="text-gray-300 hover:text-primary-600 p-1"
                              title="Editar registro"
                              onClick={() => {
                                if (isEditing) { setEditVisitId(null); return }
                                setEditVisitId(v.id)
                                setEditVisitForm({ check_in: v.check_in?.slice(0,5) || '', check_out: v.check_out?.slice(0,5) || '', observations: v.observations || '' })
                              }}
                            >
                              <Edit size={14} />
                            </button>
                          </td>
                        </tr>
                        {isEditing && (
                          <tr className="bg-blue-50 border-b border-blue-100">
                            <td colSpan={8} className="px-3 py-3">
                              <div className="flex items-center gap-3 flex-wrap">
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-gray-500 font-medium">Entrada</label>
                                  <input type="time" className="input py-1 text-sm w-28" value={editVisitForm.check_in} onChange={e => setEditVisitForm(p => ({ ...p, check_in: e.target.value }))} />
                                </div>
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-gray-500 font-medium">Saída</label>
                                  <input type="time" className="input py-1 text-sm w-28" value={editVisitForm.check_out} onChange={e => setEditVisitForm(p => ({ ...p, check_out: e.target.value }))} />
                                </div>
                                <input type="text" className="input py-1 text-sm flex-1 min-w-36" placeholder="Observação (opcional)" value={editVisitForm.observations} onChange={e => setEditVisitForm(p => ({ ...p, observations: e.target.value }))} />
                                <button
                                  className="btn-primary text-sm py-1 px-3"
                                  disabled={updateVisit.isPending}
                                  onClick={() => updateVisit.mutate({ visitId: v.id, ...editVisitForm })}
                                >Salvar</button>
                                <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setEditVisitId(null)}>Cancelar</button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
                {realized.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 font-semibold text-gray-700">
                      <td className="py-2 px-2" colSpan={5}>{realized.length} visita(s) realizadas</td>
                      <td className="py-2 px-2">{fmtH(totalMin)}</td>
                      <td className="py-2 px-2">R$ {totalVal.toFixed(2)}</td>
                      <td className="py-2 px-2"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )
      })()}

      {/* DOCUMENTOS */}
      {tab === 'arquivos' && (
        <div className="card p-5 space-y-5">
          <h3 className="font-medium">Documentos do Colaborador</h3>
          <p className="text-sm text-gray-500 -mt-3">Contratos, fotos, certidões e qualquer outro arquivo vinculado a este colaborador.</p>

          {/* Upload novo documento */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-gray-700">Adicionar documento</p>
            <input
              ref={newDocFileRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.webp"
              onChange={e => setNewDocFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex gap-2">
              <input
                className="input flex-1 text-sm"
                placeholder="Nome do documento (ex: Contrato, Foto 3x4, RG)"
                value={newDocLabel}
                onChange={e => setNewDocLabel(e.target.value)}
              />
              <button
                className="btn-secondary text-sm flex items-center gap-1.5 whitespace-nowrap"
                onClick={() => newDocFileRef.current?.click()}
              >
                <Upload size={14} />
                {newDocFile ? newDocFile.name.length > 20 ? newDocFile.name.slice(0, 20) + '…' : newDocFile.name : 'Escolher arquivo'}
              </button>
              <button
                className="btn-primary text-sm"
                onClick={uploadNewDoc}
                disabled={uploadingNewDoc || !newDocLabel.trim()}
              >
                {uploadingNewDoc ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
            {newDocFile && <p className="text-xs text-green-600">Arquivo pronto: {newDocFile.name}</p>}
          </div>

          {/* Lista de arquivos */}
          <div className="space-y-2">
            {docs?.length === 0 && <p className="text-sm text-gray-400">Nenhum documento salvo ainda.</p>}
            {docs?.map(d => {
              const fileUrl = (d as { file_url?: string }).file_url
              return (
                <div key={d.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50 gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xl">{fileUrl ? (fileUrl.match(/\.(jpg|jpeg|png|webp)/i) ? '🖼️' : '📄') : '📋'}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{d.name}</p>
                      {!fileUrl && <p className="text-xs text-amber-500">Arquivo não enviado</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {fileUrl ? (
                      <SignedLink value={fileUrl} bucket="arquivos" className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1">
                        <ExternalLink size={12} />Abrir
                      </SignedLink>
                    ) : (
                      <button
                        className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
                        disabled={uploadingDocId === d.id}
                        onClick={() => { setPendingDocUpload(d.id); docFileRef.current?.click() }}
                      >
                        <Upload size={12} />
                        {uploadingDocId === d.id ? 'Enviando…' : 'Anexar arquivo'}
                      </button>
                    )}
                    <button
                      className="p-1.5 text-gray-300 hover:text-red-500 rounded"
                      onClick={() => deleteDoc.mutate({ docId: d.id, fileUrl: fileUrl ?? undefined })}
                    ><Trash2 size={14} /></button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* hidden input para upload em docs existentes sem arquivo */}
          <input
            ref={docFileRef}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.webp"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file && pendingDocUpload) uploadDocFile(pendingDocUpload, file)
              e.target.value = ''
            }}
          />
        </div>
      )}

      {/* HISTORICO */}
      {tab === 'historico' && (
        <div className="space-y-4">
          {/* Passagens: por onde já passou (vagas + coberturas) */}
          <div className="card p-5 space-y-3">
            <h3 className="font-medium">Passagens</h3>
            {(placements?.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-400">Nenhuma passagem encerrada registrada ainda.</p>
            ) : (
              <div className="space-y-2">
                {placements?.map(p => {
                  const days = p.start_date && p.end_date
                    ? Math.max(1, Math.round((new Date(p.end_date).getTime() - new Date(p.start_date).getTime()) / 86400000))
                    : null
                  const svcColor = p.service_type === 'Volante'
                    ? 'bg-orange-100 text-orange-700'
                    : p.service_type === 'Consultoria'
                    ? 'bg-purple-100 text-purple-700'
                    : 'bg-blue-100 text-blue-700'
                  return (
                    <div key={p.id} className="p-3 rounded-lg border-l-4 border-gray-300 bg-gray-50/50">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          {p.service_type && <span className={`badge ${svcColor}`}>{p.service_type}</span>}
                          <span className="font-medium text-sm text-gray-800 truncate">{p.client_name}</span>
                          {p.vacancy_title && <span className="text-xs text-gray-500">· {p.vacancy_title}</span>}
                        </div>
                        <span className="text-xs text-gray-400">{formatDate(p.end_date)}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {p.start_date ? formatDate(p.start_date) : '?'} → {formatDate(p.end_date)}
                        {days !== null && ` · ${days} dia${days === 1 ? '' : 's'}`}
                        {p.monthly_amount ? ` · ${formatCurrency(Number(p.monthly_amount))}` : ''}
                      </p>
                      {p.dismissal_reason && <p className="text-xs text-gray-500 italic mt-0.5">{p.dismissal_reason}</p>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Histórico manual */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Histórico Geral</h3>
              <button onClick={() => setShowHistoryForm(true)} className="btn-secondary text-sm flex items-center gap-1"><Plus size={14} />Adicionar</button>
            </div>
            {showHistoryForm && (
              <div className="bg-gray-50 p-4 rounded-lg space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Tipo</label>
                    <select className="input" value={histForm.type} onChange={e => setHistForm(p => ({ ...p, type: e.target.value }))}>
                      <option>Mudança de cargo</option><option>Aumento</option><option>Advertência</option><option>Anotação</option>
                    </select>
                  </div>
                  <div><label className="label">Responsável</label><input className="input" value={histForm.responsible} onChange={e => setHistForm(p => ({ ...p, responsible: e.target.value }))} /></div>
                  <div className="col-span-2"><label className="label">Descrição *</label><textarea className="input" rows={2} required value={histForm.description} onChange={e => setHistForm(p => ({ ...p, description: e.target.value }))} /></div>
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary text-sm" onClick={() => addHistory.mutate()} disabled={!histForm.description}>Salvar</button>
                  <button className="btn-secondary text-sm" onClick={() => setShowHistoryForm(false)}>Cancelar</button>
                </div>
              </div>
            )}
            <div className="space-y-3">
              {history?.map(h => (
                <div key={h.id} className="flex gap-3 p-3 rounded-lg border-l-4 border-primary-300 bg-primary-50/30">
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="badge bg-primary-100 text-primary-700">{h.type}</span>
                      <span className="text-xs text-gray-400">{formatDate(h.created_at)}</span>
                    </div>
                    <p className="text-sm mt-1">{h.description}</p>
                    {h.responsible && <p className="text-xs text-gray-500 mt-0.5">Por: {h.responsible}</p>}
                  </div>
                </div>
              ))}
              {history?.length === 0 && <p className="text-sm text-gray-400">Nenhum histórico registrado</p>}
            </div>
          </div>

          {/* Histórico automático de vínculos */}
          <div className="card p-5 space-y-3">
            <h3 className="font-medium">Histórico de Vínculos</h3>
            {(linkHistory?.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-400">Nenhuma alteração de vínculo registrada</p>
            ) : (
              <div className="space-y-2">
                {linkHistory?.map((h: Record<string, unknown>) => {
                  const action = h.action as string
                  const colors = action === 'criado'
                    ? 'border-green-400 bg-green-50/40'
                    : action === 'encerrado'
                    ? 'border-red-400 bg-red-50/40'
                    : 'border-amber-400 bg-amber-50/40'
                  const badge = action === 'criado'
                    ? 'bg-green-100 text-green-700'
                    : action === 'encerrado'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-700'
                  return (
                    <div key={h.id as string} className={`p-3 rounded-lg border-l-4 ${colors}`}>
                      <div className="flex items-center justify-between">
                        <span className={`badge ${badge} capitalize`}>{action}</span>
                        <span className="text-xs text-gray-400">{formatDate(h.changed_at as string)}</span>
                      </div>
                      <p className="text-sm mt-1">{h.description as string}</p>
                      {(h.changed_by as string | null) && (
                        <p className="text-xs text-gray-500 mt-0.5">Por: {h.changed_by as string}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PORTAL */}
      {tab === 'portal' && (
        <PortalTab employeeId={id!} employee={employee} />
      )}
    </div>
  )
}

// ─── VISÃO GERAL COMPONENT ───────────────────────────────────────────────────
function VisaoGeral({
  employeeId,
  employee,
  links,
  docs,
}: {
  employeeId: string
  employee: Record<string, unknown>
  links: (EmployeeClientLink & { payment_dates: EmployeePaymentDate[]; client?: { id: string; name: string } })[]
  docs: { id: string; name: string; status: string }[]
}) {
  const { role } = useAuth()
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'))

  const monthDate = new Date(selectedMonth + '-15')
  const monthStart = format(startOfMonth(monthDate), 'yyyy-MM-dd')
  const monthEnd = format(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0), 'yyyy-MM-dd')

  const { data: visits } = useQuery({
    queryKey: ['visao-visits', employeeId, selectedMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nutritionist_visits')
        .select('id, visit_date, check_in, check_out, unit_name, visit_rate, client_id, client:clients(name)')
        .eq('employee_id', employeeId)
        .gte('visit_date', monthStart)
        .lte('visit_date', monthEnd)
        .order('visit_date')
      if (error) throw error
      return data || []
    },
  })

  const { data: agendaItems } = useQuery({
    queryKey: ['visao-agenda', employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nutritionist_agenda')
        .select('id, planned_date, planned_time, notes, original_date, rescheduled_at, client:clients(name), unit:client_units(name)')
        .eq('employee_id', employeeId)
        .gte('planned_date', format(new Date(), 'yyyy-MM-dd'))
        .order('planned_date')
        .limit(10)
      if (error) throw error
      return data || []
    },
  })

  // Calendar data
  const daysInMonth = getDaysInMonth(monthDate)
  const firstDow = getDay(startOfMonth(monthDate)) // 0=Sun
  const today = new Date().toISOString().slice(0, 10)
  const visitedDays = new Set(visits?.map(v => Number(v.visit_date?.slice(8, 10))) ?? [])
  const todayDay = selectedMonth === format(new Date(), 'yyyy-MM') ? new Date().getDate() : null

  // Stats
  const pendingDocs = docs.filter(d => d.status === 'Pendente')
  const allVisits_q = useQuery({
    queryKey: ['visao-last-visit', employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from('nutritionist_visits')
        .select('visit_date')
        .eq('employee_id', employeeId)
        .order('visit_date', { ascending: false })
        .limit(1)
      return data || []
    },
  })
  const lastVisitDate = allVisits_q.data?.[0]?.visit_date
  const daysSinceLast = lastVisitDate ? differenceInDays(new Date(), new Date(lastVisitDate + 'T12:00:00')) : null

  const totalEarningsMonth = (visits || []).reduce((s, v) => s + (Number(v.visit_rate) || 0), 0)
  const workedDaysMonth = (visits || []).filter(v => v.check_out).length

  const DOW_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

  return (
    <div className="space-y-4">
      {/* ── Alert Strip ── */}
      {(pendingDocs.length > 0 || (daysSinceLast !== null && daysSinceLast > 7)) && (
        <div className="space-y-2">
          {pendingDocs.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-amber-500 text-lg">⚠️</span>
              <div>
                <p className="text-sm font-semibold text-amber-800">{pendingDocs.length} documento{pendingDocs.length > 1 ? 's' : ''} pendente{pendingDocs.length > 1 ? 's' : ''}</p>
                <p className="text-xs text-amber-600">{pendingDocs.map(d => d.name).join(', ')}</p>
              </div>
            </div>
          )}
          {daysSinceLast !== null && daysSinceLast > 7 && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-red-500 text-lg">🔴</span>
              <div>
                <p className="text-sm font-semibold text-red-800">Sem visita há {daysSinceLast} dias</p>
                <p className="text-xs text-red-600">Última visita em {lastVisitDate ? format(new Date(lastVisitDate + 'T12:00:00'), 'dd/MM/yyyy') : '—'}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Contracts ── */}
      <div className="card p-4 space-y-3">
        <h3 className="font-semibold text-gray-900 text-sm">Contratos Ativos</h3>
        {links.length === 0 && <p className="text-sm text-gray-400">Nenhum vínculo cadastrado</p>}
        {links.map(l => {
          const client = l.client as { name: string } | undefined
          const isConsultoria = l.service_type === 'Consultoria'
          return (
            <div key={l.id} className={`rounded-xl p-3 border ${isConsultoria ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200'}`}>
              <div className="flex items-center justify-between">
                <p className="font-semibold text-sm text-gray-900">{client?.name}</p>
                <span className={`badge text-xs ${isConsultoria ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                  {l.service_type}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {l.monthly_amount && role === 'chefe' && (
                  <span className="text-xs text-gray-600 flex items-center gap-1">💰 {formatCurrency(l.monthly_amount)}/mês</span>
                )}
                {l.weekly_hours_quota && (
                  <span className="text-xs text-gray-600 flex items-center gap-1">⏱ {l.weekly_hours_quota}h/semana</span>
                )}
                {l.start_date && (
                  <span className="text-xs text-gray-500">desde {formatDate(l.start_date)}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Calendar ── */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 text-sm">Calendário de Presença</h3>
          <input
            type="month"
            className="input w-36 text-sm py-1"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
          />
        </div>

        {/* Month stats */}
        <div className="flex gap-3 mb-3">
          <div className="flex-1 bg-gray-50 rounded-lg p-2 text-center">
            <p className="text-xl font-bold text-gray-900">{workedDaysMonth}</p>
            <p className="text-xs text-gray-500">dias</p>
          </div>
          {totalEarningsMonth > 0 && (
            <div className="flex-1 bg-green-50 rounded-lg p-2 text-center">
              <p className="text-base font-bold text-green-700">R$ {totalEarningsMonth.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}</p>
              <p className="text-xs text-gray-500">consultoria</p>
            </div>
          )}
        </div>

        {/* Day of week headers */}
        <div className="grid grid-cols-7 mb-1">
          {DOW_LABELS.map(d => (
            <div key={d} className="text-center text-xs text-gray-400 font-medium py-1">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-0.5">
          {/* blank cells before day 1 */}
          {Array.from({ length: firstDow }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {/* day cells */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const hasVisit = visitedDays.has(day)
            const isToday = todayDay === day
            const isFuture = selectedMonth === format(new Date(), 'yyyy-MM') && day > (new Date().getDate())
            return (
              <div
                key={day}
                className={`aspect-square flex items-center justify-center rounded-lg text-xs font-medium transition-colors
                  ${hasVisit ? 'bg-primary-600 text-white shadow-sm' : isToday ? 'ring-2 ring-primary-400 text-primary-700 bg-primary-50' : isFuture ? 'text-gray-300' : 'text-gray-500 hover:bg-gray-50'}
                `}
              >
                {day}
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-primary-600 inline-block" /> Trabalhou</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded ring-2 ring-primary-400 inline-block" /> Hoje</span>
        </div>
      </div>

      {/* ── Agenda ── */}
      {agendaItems && agendaItems.length > 0 && (
        <div className="card p-4 space-y-2">
          <h3 className="font-semibold text-gray-900 text-sm">Próximas Visitas Agendadas</h3>
          {agendaItems.map(a => {
            const cName = (a as { client?: { name: string } }).client?.name
            const uName = (a as { unit?: { name: string } }).unit?.name || a.notes
            const orig = (a as { original_date?: string }).original_date
            const wasResched = orig && orig !== a.planned_date
            return (
              <div key={a.id} className={`flex items-center gap-3 p-2 rounded-lg ${wasResched ? 'bg-amber-50' : 'bg-gray-50'}`}>
                <div className="w-9 h-9 rounded-xl bg-primary-50 flex flex-col items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-primary-700 leading-none">{format(new Date(a.planned_date + 'T12:00:00'), 'dd')}</span>
                  <span className="text-xs text-primary-400 leading-none">{format(new Date(a.planned_date + 'T12:00:00'), 'MMM', { locale: ptBR })}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{uName || cName}</p>
                  <p className="text-xs text-gray-400">{cName}</p>
                  {wasResched && <p className="text-xs text-amber-600">🔁 remarcada — era {format(new Date(orig! + 'T12:00:00'), 'dd/MM')}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Document Status ── */}
      {docs.length > 0 && (
        <div className="card p-4 space-y-2">
          <h3 className="font-semibold text-gray-900 text-sm">Documentação</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {docs.map(d => (
              <div key={d.id} className={`flex items-center gap-2 p-2 rounded-lg text-xs ${d.status === 'Entregue' ? 'bg-green-50 text-green-700' : d.status === 'Pendente' ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-400'}`}>
                <span>{d.status === 'Entregue' ? '✓' : d.status === 'Pendente' ? '⚠' : '—'}</span>
                <span className="truncate">{d.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── RESUMO DA FOLHA DE PONTO (Pagamentos) ───────────────────────────────────
function FolhaResumo({ employeeId, employeeName, links, payMonth, onMonthChange }: {
  employeeId: string
  employeeName: string
  links: (EmployeeClientLink & { client?: { id: string; name: string } })[]
  payMonth: string
  onMonthChange: (m: string) => void
}) {
  const monthDate = new Date(payMonth + '-15')
  const monthStart = format(startOfMonth(monthDate), 'yyyy-MM-dd')
  const monthEnd = format(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0), 'yyyy-MM-dd')

  const { data: visits } = useQuery({
    queryKey: ['resumo-visits', employeeId, payMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nutritionist_visits')
        .select('*, client:clients(name)')
        .eq('employee_id', employeeId)
        .gte('visit_date', monthStart)
        .lte('visit_date', monthEnd)
        .order('visit_date')
      if (error) throw error
      return data || []
    },
  })

  // Avisos da agenda do portal (falta avisada / troca de dia) no mês
  const { data: monthNotices } = useQuery({
    queryKey: ['resumo-notices', employeeId, payMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_notices')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('notice_date', monthStart)
        .lte('notice_date', monthEnd)
        .order('notice_date')
      if (error) throw error
      return data || []
    },
  })

  // Saída menor que entrada = turno noturno que vira a meia-noite (ex: 19:00 → 07:00)
  const durMin = (ci?: string, co?: string) => {
    if (!ci || !co) return 0
    const [h1, m1] = ci.slice(0, 5).split(':').map(Number)
    const [h2, m2] = co.slice(0, 5).split(':').map(Number)
    const d = (h2 * 60 + m2) - (h1 * 60 + m1)
    if (d === 0) return 0
    return d > 0 ? d : d + 24 * 60
  }
  const fmtH = (h: number) => `${Math.floor(h)}h${Math.round((h % 1) * 60) > 0 ? Math.round((h % 1) * 60) + 'min' : ''}`

  // Computa por vínculo
  const summaries = links.map(link => {
    const clientId = link.client?.id
    const isConsultoria = link.service_type === 'Consultoria'
    const v = (visits || []).filter(x => x.client_id === clientId)
    const worked = v.filter(x => x.check_out && !(x as { is_unavailable?: boolean }).is_unavailable)
    const faltas = v.filter(x => (x as { is_unavailable?: boolean }).is_unavailable)
    const extraDays = v.filter(x => (x as { is_extra?: boolean }).is_extra)
    const extraDaysTotal = extraDays.reduce((s, x) => s + (Number((x as { extra_amount?: number }).extra_amount) || 0), 0)
    const earnings = isConsultoria ? v.reduce((s, x) => s + (Number(x.visit_rate) || 0), 0) : 0

    // Fixo: horas extras
    const dailyHours = !isConsultoria ? (Number((link as { daily_hours?: number }).daily_hours) || null) : null
    let extraHours = 0
    if (dailyHours) {
      for (const x of v) {
        if ((x as { is_unavailable?: boolean }).is_unavailable || (x as { is_extra?: boolean }).is_extra) continue
        const raw = durMin(x.check_in, x.check_out)
        const brk = durMin((x as { break_start?: string }).break_start, (x as { break_end?: string }).break_end)
        const net = Math.max(0, raw - brk) / 60
        if (net > dailyHours) extraHours += net - dailyHours
      }
    }
    // Valor-hora pela escala do mês (dias de trabalho previstos), não pelos dias registrados
    const lk = link as { days_off?: number[]; work_schedule_type?: string; schedule_anchor_date?: string }
    const hasSchedule = !isConsultoria && (!!lk.days_off?.length || (lk.work_schedule_type === '12x36' && !!lk.schedule_anchor_date))
    let scheduledDays: number | null = null
    if (hasSchedule) {
      const dim = getDaysInMonth(monthDate)
      scheduledDays = 0
      for (let i = 1; i <= dim; i++) {
        const ds = `${payMonth}-${String(i).padStart(2, '0')}`
        let off = false
        if (lk.work_schedule_type === '12x36' && lk.schedule_anchor_date) {
          const diff = Math.round((new Date(ds + 'T12:00:00').getTime() - new Date(lk.schedule_anchor_date + 'T12:00:00').getTime()) / 86400000)
          off = ((diff % 2) + 2) % 2 === 1
        } else {
          off = !!lk.days_off?.includes(new Date(ds + 'T12:00:00').getDay())
        }
        if (!off) scheduledDays++
      }
    }
    const baseDays = scheduledDays || worked.length
    const hourlyRate = (!isConsultoria && Number(link.monthly_amount) && baseDays && dailyHours)
      ? Number(link.monthly_amount) / baseDays / dailyHours : null
    const extraHoursValue = hourlyRate ? Math.round(extraHours * hourlyRate * 100) / 100 : 0

    const linkNotices = (monthNotices || []).filter(n => n.client_id === clientId)
    const faltaAvisos = linkNotices.filter(n => n.type === 'falta')
    const trocas = linkNotices.filter(n => n.type === 'troca')

    // Consultoria: contagem de visitas esperadas vs realizadas
    const visitsPerWeek = isConsultoria ? (Number((link as { visits_per_week?: number }).visits_per_week) || null) : null
    const expectedVisits = visitsPerWeek ? visitsPerWeek * 4 : null
    const weeklyHoursQuota = isConsultoria ? (Number((link as { weekly_hours_quota?: number }).weekly_hours_quota) || null) : null
    const weeklyCapH = weeklyHoursQuota ?? Infinity
    // Cada visita conta no máximo a cota semanal (excesso vai para aprovação)
    const totalHoursConsultoria = isConsultoria ? v.reduce((s, x) => {
      const raw = durMin(x.check_in, x.check_out)
      const brk = durMin((x as { break_start?: string }).break_start, (x as { break_end?: string }).break_end)
      return s + Math.min(Math.max(0, raw - brk) / 60, weeklyCapH)
    }, 0) : 0
    const monthlyHoursQuota = isConsultoria ? (Number((link as { monthly_hours_quota?: number }).monthly_hours_quota) || null) : null

    return { link, isConsultoria, v, worked, faltas, extraDays, extraDaysTotal, earnings, extraHours, hourlyRate, extraHoursValue, faltaAvisos, trocas, visitsPerWeek, expectedVisits, totalHoursConsultoria, monthlyHoursQuota }
  })

  const downloadPDF = () => {
    const monthLabel = monthDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    const blocks = summaries.map(s => {
      const rows = s.v.map(x => {
        const isUn = (x as { is_unavailable?: boolean }).is_unavailable
        const isEx = (x as { is_extra?: boolean }).is_extra
        const isSw = (x as { is_swap?: boolean }).is_swap
        const tag = isUn ? 'FALTA' : isEx ? 'DIA EXTRA' : isSw ? 'TROCA' : ''
        const dur = x.check_in && x.check_out ? fmtH(Math.max(0, durMin(x.check_in, x.check_out) - durMin((x as { break_start?: string }).break_start, (x as { break_end?: string }).break_end)) / 60) : '-'
        return `<tr><td>${formatDate(x.visit_date)}</td><td>${x.check_in?.slice(0,5) || '-'}</td><td>${x.check_out?.slice(0,5) || '-'}</td><td>${dur}</td><td>${x.unit_name || ''}</td><td>${tag}</td><td>${(x as { observations?: string }).observations || ''}</td></tr>`
      }).join('')
      const extras: string[] = []
      if (s.isConsultoria) {
        const visitLabel = s.expectedVisits ? `${s.v.length}/${s.expectedVisits} visitas` : `${s.v.length} visita(s)`
        const hoursLabel = s.monthlyHoursQuota ? ` · ${fmtH(s.totalHoursConsultoria)} de ${fmtH(s.monthlyHoursQuota)}h` : ''
        extras.push(`${visitLabel}${hoursLabel} · A receber: R$ ${s.earnings.toFixed(2)}`)
      }
      else {
        extras.push(`Dias trabalhados: ${s.worked.length}`)
        if (s.faltas.length) extras.push(`Faltas: ${s.faltas.length}`)
        if (s.extraDays.length) extras.push(`Dias extras: ${s.extraDays.length} (+R$ ${s.extraDaysTotal.toFixed(2)})`)
        if (s.extraHours > 0.05) extras.push(`Horas extras: ${fmtH(s.extraHours)} (+R$ ${s.extraHoursValue.toFixed(2)})`)
      }
      return `<h2>${s.link.client?.name || '—'} <span style="font-weight:normal;color:#888">(${s.link.service_type})</span></h2>
        <p style="color:#555;font-size:13px">${extras.join(' &nbsp;•&nbsp; ')}</p>
        <table><thead><tr><th>Data</th><th>Entrada</th><th>Saída</th><th>Duração</th><th>Unidade</th><th>Tipo</th><th>Obs.</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="color:#aaa">Nenhum registro</td></tr>'}</tbody></table>`
    }).join('<hr style="margin:24px 0;border:none;border-top:1px solid #eee"/>')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Folha de Ponto – ${employeeName} – ${monthLabel}</title>
      <style>body{font-family:Arial,sans-serif;padding:30px;color:#1a1a1a}h1{font-size:20px;margin-bottom:2px}h2{font-size:15px;margin:16px 0 4px}.sub{color:#666;font-size:14px;margin-bottom:20px}
      table{width:100%;border-collapse:collapse;margin-top:6px}th{background:#f3f4f6;text-align:left;padding:6px 10px;font-size:11px;text-transform:uppercase;border-bottom:2px solid #e5e7eb}
      td{padding:6px 10px;border-bottom:1px solid #f3f4f6;font-size:12px}</style></head><body>
      <h1>Folha de Ponto — ${employeeName}</h1><div class="sub">${monthLabel}</div>${blocks}
      <script>window.print()</script></body></html>`
    const w = window.open('', '_blank')!
    w.document.write(html); w.document.close()
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold">Resumo da Folha de Ponto</h3>
          <p className="text-xs text-gray-400">Dias trabalhados e o que precisa de atenção no mês.</p>
        </div>
        <div className="flex items-center gap-2">
          <input className="input w-36 text-sm" type="month" value={payMonth} onChange={e => onMonthChange(e.target.value)} />
          <button onClick={downloadPDF} className="btn-secondary text-sm flex items-center gap-1.5"><Download size={14} />PDF</button>
        </div>
      </div>

      {summaries.length === 0 && <p className="text-sm text-gray-400">Nenhum vínculo cadastrado.</p>}

      {summaries.map(s => (
        <div key={s.link.id} className={`rounded-xl p-4 border ${s.isConsultoria ? 'bg-orange-50 border-orange-200' : 'bg-blue-50 border-blue-200'}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold text-sm">{s.link.client?.name}</p>
            <span className={`badge text-xs ${s.isConsultoria ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{s.link.service_type}</span>
          </div>

          {s.isConsultoria ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {s.expectedVisits ? (
                    <span className={`font-semibold ${s.v.length >= s.expectedVisits ? 'text-green-700' : s.v.length >= s.expectedVisits * 0.75 ? 'text-amber-600' : 'text-red-600'}`}>
                      {s.v.length}/{s.expectedVisits} visitas
                    </span>
                  ) : (
                    <span className="text-gray-600">{s.v.length} visita(s)</span>
                  )}
                  {s.monthlyHoursQuota && (
                    <span className="text-xs text-gray-400">({fmtH(s.totalHoursConsultoria)} de {fmtH(s.monthlyHoursQuota)} h)</span>
                  )}
                </div>
                <span className="font-bold text-green-700">R$ {s.earnings.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>
              {(() => {
                const weeklyQ = Number((s.link as { weekly_hours_quota?: number }).weekly_hours_quota) || 0
                const overVisits = weeklyQ > 0 ? s.v.filter(x => {
                  const raw = durMin(x.check_in, x.check_out)
                  const brk = durMin((x as { break_start?: string }).break_start, (x as { break_end?: string }).break_end)
                  return Math.max(0, raw - brk) / 60 > weeklyQ + 0.1
                }) : []
                if (overVisits.length === 0) return null
                return (
                  <div className="bg-amber-50 border border-amber-300 rounded-lg p-2 text-xs text-amber-800">
                    ⚠ <strong>{overVisits.length} visita(s) excederam o combinado semanal de {fmtH(weeklyQ)}</strong> — o responsável precisa definir se o excedente será pago.
                  </div>
                )
              })()}
              {s.monthlyHoursQuota && s.totalHoursConsultoria < s.monthlyHoursQuota - 0.1 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-700">
                  ↓ <strong>Abaixo do combinado: {fmtH(s.totalHoursConsultoria)} de {fmtH(s.monthlyHoursQuota)} h</strong> — desconto proporcional de {((1 - s.totalHoursConsultoria / s.monthlyHoursQuota) * 100).toFixed(0)}% aplicável.
                </div>
              )}
              {s.expectedVisits && s.v.length < s.expectedVisits && !s.monthlyHoursQuota && (
                <p className="text-xs text-amber-600">⚠ Faltam {s.expectedVisits - s.v.length} visita(s) para completar o mês</p>
              )}
              {s.v.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {s.v.map(x => (
                    <span key={x.id} className="text-xs bg-white border border-orange-200 text-orange-700 px-2 py-0.5 rounded-full">
                      {formatDate(x.visit_date)}{x.unit_name ? ` · ${x.unit_name}` : ''}{x.visit_rate ? ` · R$ ${Number(x.visit_rate).toFixed(0)}` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            // Fixo: só o que importa (faltas, dias extras, horas extras). Sem exceções = trabalhando normal.
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">{s.worked.length} dia(s) trabalhado(s)</span>
              </div>
              {s.faltas.length === 0 && s.extraDays.length === 0 && s.extraHours <= 0.05 && s.faltaAvisos.length === 0 && s.trocas.length === 0 ? (
                <p className="text-green-700 text-xs flex items-center gap-1">✓ Trabalhando normalmente — sem exceções neste mês.</p>
              ) : (
                <div className="space-y-1">
                  {s.extraDays.length > 0 && (
                    <div className="flex items-center justify-between bg-white/60 rounded px-2 py-1">
                      <span className="text-green-700">⭐ {s.extraDays.length} dia(s) extra</span>
                      <span className="font-semibold text-green-800">+ R$ {s.extraDaysTotal.toFixed(2)}</span>
                    </div>
                  )}
                  {s.extraHours > 0.05 && (
                    <div className="flex items-center justify-between bg-white/60 rounded px-2 py-1">
                      <span className="text-green-700">⏱ {fmtH(s.extraHours)} hora extra{s.hourlyRate ? ` (R$ ${s.hourlyRate.toFixed(2)}/h)` : ''}</span>
                      {s.extraHoursValue ? <span className="font-semibold text-green-800">+ R$ {s.extraHoursValue.toFixed(2)}</span> : null}
                    </div>
                  )}
                  {s.faltas.length > 0 && (
                    <div className="bg-white/60 rounded px-2 py-1">
                      <div className="flex items-center justify-between">
                        <span className="text-red-700">🚫 {s.faltas.length} falta(s)</span>
                      </div>
                      <p className="text-xs text-red-500 mt-0.5">{s.faltas.map(f => `${formatDate(f.visit_date)}${(f as { unavailability_reason?: string }).unavailability_reason ? ` (${(f as { unavailability_reason?: string }).unavailability_reason})` : ''}`).join(', ')}</p>
                    </div>
                  )}
                  {s.faltaAvisos.length > 0 && (
                    <div className="bg-white/60 rounded px-2 py-1">
                      <span className="text-red-700">🔔 Falta(s) avisada(s) pela agenda</span>
                      <p className="text-xs text-red-500 mt-0.5">{s.faltaAvisos.map(n => `${formatDate(n.notice_date)}${n.reason ? ` (${n.reason})` : ''}`).join(', ')}</p>
                    </div>
                  )}
                  {s.trocas.length > 0 && (
                    <div className="bg-white/60 rounded px-2 py-1">
                      <span className="text-amber-700">🔁 Troca(s) de dia</span>
                      <p className="text-xs text-amber-600 mt-0.5">{s.trocas.map(n => `folga ${formatDate(n.notice_date)} → trabalha ${n.swap_work_date ? formatDate(n.swap_work_date) : '?'}`).join(' · ')}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function PortalTab({ employeeId, employee }: { employeeId: string; employee: Record<string, unknown> | null | undefined }) {
  const qc = useQueryClient()
  const [newPin, setNewPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [lastPin, setLastPin] = useState('') // senha recém-definida, mostrada uma vez para copiar

  const { data: visits } = useQuery({
    queryKey: ['portal-visits-admin', employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nutritionist_visits')
        .select('*, client:clients(name)')
        .eq('employee_id', employeeId)
        .order('visit_date', { ascending: false })
        .limit(30)
      if (error) throw error
      return data || []
    },
  })

  const savePin = async () => {
    if (newPin.trim().length < 6) { toast.error('A senha precisa de ao menos 6 caracteres'); return }
    setSaving(true)
    // Guardada só como hash, pela função no servidor
    const { error } = await supabase.rpc('portal_set_pin', { p_employee: employeeId, p_pin: newPin.trim() })
    if (error) toast.error('Erro ao salvar: ' + error.message)
    else {
      toast.success('Senha do portal atualizada!')
      qc.invalidateQueries({ queryKey: ['employee', employeeId] })
      setLastPin(newPin.trim())
      setNewPin('')
    }
    setSaving(false)
  }

  const portalUrl = `${window.location.origin}/portal`
  const hasPin = !!(employee as { portal_pin_hash?: string; portal_pin?: string })?.portal_pin_hash
    || !!(employee as { portal_pin?: string })?.portal_pin
  const cpf = (employee as { cpf?: string })?.cpf || '-'

  const copyAccess = () => {
    const text = `Portal Time IN: ${portalUrl}\nCPF: ${cpf}\nSenha: ${lastPin || '(defina uma nova senha abaixo)'}`
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      {/* Access card */}
      <div className="card p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold">Acesso ao Portal</h3>
            <p className="text-sm text-gray-500 mt-0.5">O nutricionista acessa em <strong>/portal</strong> com CPF + senha</p>
          </div>
          <span className={`badge ${hasPin ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {hasPin ? '✓ Ativo' : 'Sem acesso'}
          </span>
        </div>

        <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Link:</span>
            <span className="font-mono text-primary-600">{window.location.origin}/portal</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">CPF (login):</span>
            <span className="font-mono">{cpf}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-500">Senha:</span>
            <span className="font-mono">{lastPin ? lastPin : hasPin ? '•••••• (definida)' : '—'}</span>
          </div>
        </div>

        {lastPin ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
            ⚠ Anote/copie agora — por segurança a senha é guardada criptografada e <strong>não pode ser revelada depois</strong>. Se perder, gere uma nova.
          </div>
        ) : hasPin ? (
          <p className="text-xs text-gray-400">A senha fica criptografada (não dá pra revelar). Se o colaborador esquecer, defina uma nova abaixo.</p>
        ) : null}

        {(lastPin || hasPin) && (
          <button onClick={copyAccess} className="btn-secondary w-full text-sm" disabled={!lastPin && !hasPin}>
            {copied ? '✓ Copiado!' : '📋 Copiar dados de acesso para enviar'}
          </button>
        )}

        <div className="border-t pt-4 space-y-2">
          <label className="label">{hasPin ? 'Alterar senha' : 'Criar senha de acesso'}</label>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              type="text"
              placeholder="Ex: nutri2025"
              value={newPin}
              onChange={e => setNewPin(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && savePin()}
            />
            <button className="btn-primary" onClick={savePin} disabled={saving || !newPin}>
              {saving ? '...' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>

      {/* Visit history */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold">Visitas Registradas</h3>
        {visits?.length === 0 && (
          <p className="text-sm text-gray-400">Nenhuma visita registrada ainda</p>
        )}
        <div className="space-y-2">
          {visits?.map(v => (
            <div key={v.id} className="flex items-start justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{formatDate(v.visit_date)}</span>
                  <span className="text-xs text-gray-500 bg-white border rounded-full px-2 py-0.5">
                    {v.check_in?.slice(0, 5)} — {v.check_out?.slice(0, 5)}
                  </span>
                </div>
                <p className="text-xs text-primary-600 mt-0.5">{(v as { client?: { name: string } }).client?.name}</p>
                {v.observations && <p className="text-xs text-gray-500 mt-1">{v.observations}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
