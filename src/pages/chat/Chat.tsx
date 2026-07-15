import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, MessageSquare, Users, Search, MessageCircle, Plus, X, ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { formatDate, getInitials } from '../../lib/utils'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import toast from 'react-hot-toast'

type Tab = 'colaboradores' | 'interno'

type EmpQuestion = {
  id: string
  employee_id: string
  message: string | null
  answer: string | null
  answered_at: string | null
  answered_by: string | null
  initiated_by_admin: boolean
  created_at: string
  employee?: { id: string; full_name: string; whatsapp?: string }
}

type Thread = {
  employee: { id: string; full_name: string; whatsapp?: string }
  messages: EmpQuestion[]
  unread: number
}

export default function Chat() {
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('colaboradores')
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [searchEmp, setSearchEmp] = useState('')
  const [internalMsg, setInternalMsg] = useState('')
  const [sendingInternal, setSendingInternal] = useState(false)
  const [showNewConv, setShowNewConv] = useState(false)
  const [newConvEmpId, setNewConvEmpId] = useState('')
  const [newConvMsg, setNewConvMsg] = useState('')
  const threadEndRef = useRef<HTMLDivElement>(null)
  const internalEndRef = useRef<HTMLDivElement>(null)

  const { data: questions } = useQuery({
    queryKey: ['chat-employee-questions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_questions')
        .select('*, employee:employees(id, full_name, whatsapp)')
        .order('created_at', { ascending: true })
        .limit(500)
      if (error) throw error
      return (data || []) as EmpQuestion[]
    },
  })

  useEffect(() => {
    const channel = supabase.channel('chat-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_questions' }, () => {
        qc.invalidateQueries({ queryKey: ['chat-employee-questions'] })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc])

  const { data: allEmployees } = useQuery({
    queryKey: ['chat-all-employees'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id, full_name').eq('status', 'Ativo').order('full_name')
      if (error) throw error
      return data || []
    },
  })

  const { data: messages } = useQuery({
    queryKey: ['chat-messages'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*,user:user_profiles(id,full_name)')
        .order('created_at', { ascending: true })
        .limit(200)
      if (error) throw error
      return data || []
    },
  })

  useEffect(() => {
    const ch = supabase.channel('chat-internal')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => {
        qc.invalidateQueries({ queryKey: ['chat-messages'] })
      }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [qc])

  useEffect(() => {
    const ch = supabase.channel('chat-questions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_questions' }, () => {
        qc.invalidateQueries({ queryKey: ['chat-employee-questions'] })
      }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [qc])

  useEffect(() => { threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [questions, selectedEmployee])
  useEffect(() => { internalEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const threads: Thread[] = questions
    ? Object.values(
        questions.reduce((acc: Record<string, Thread>, q) => {
          const emp = q.employee
          if (!emp) return acc
          if (!acc[emp.id]) acc[emp.id] = { employee: emp, messages: [], unread: 0 }
          acc[emp.id].messages.push(q)
          if (!q.answer && q.message) acc[emp.id].unread++
          return acc
        }, {})
      ).sort((a, b) => (b.messages.at(-1)?.created_at || '').localeCompare(a.messages.at(-1)?.created_at || ''))
    : []

  const filteredThreads = searchEmp
    ? threads.filter(t => t.employee.full_name.toLowerCase().includes(searchEmp.toLowerCase()))
    : threads

  const selectedThread = selectedEmployee ? threads.find(t => t.employee.id === selectedEmployee) ?? null : null
  const totalUnread = questions?.filter(q => !q.answer && q.message).length ?? 0

  const answerQuestion = useMutation({
    mutationFn: async ({ id, answer }: { id: string; answer: string }) => {
      const { error } = await supabase
        .from('employee_questions')
        .update({ answer, answered_at: new Date().toISOString(), answered_by: profile?.full_name || 'RH' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['chat-employee-questions'] }); setReply('') },
    onError: (e: Error) => toast.error(e.message),
  })

  const sendAdminMessage = useMutation({
    mutationFn: async ({ employeeId, message }: { employeeId: string; message: string }) => {
      const { error } = await supabase.from('employee_questions').insert({
        employee_id: employeeId,
        answer: message,
        answered_at: new Date().toISOString(),
        answered_by: profile?.full_name || 'RH',
        initiated_by_admin: true,
      })
      if (error) throw error
    },
    onSuccess: (_, { employeeId }) => {
      qc.invalidateQueries({ queryKey: ['chat-employee-questions'] })
      setReply('')
      setSelectedEmployee(employeeId)
      setShowNewConv(false)
      setNewConvEmpId('')
      setNewConvMsg('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const sendReply = async () => {
    if (!reply.trim() || !selectedThread) return
    const unanswered = selectedThread.messages.filter(m => !m.answer && m.message)
    if (unanswered.length > 0) {
      await answerQuestion.mutateAsync({ id: unanswered.at(-1)!.id, answer: reply.trim() })
    } else {
      await sendAdminMessage.mutateAsync({ employeeId: selectedThread.employee.id, message: reply.trim() })
    }
  }

  const sendInternal = async () => {
    if (!internalMsg.trim() || !user) return
    setSendingInternal(true)
    const { error } = await supabase.from('chat_messages').insert({ user_id: user.id, content: internalMsg.trim() })
    if (error) toast.error(error.message)
    else setInternalMsg('')
    setSendingInternal(false)
  }

  const waLink = (phone?: string) => {
    if (!phone) return null
    const digits = phone.replace(/\D/g, '')
    const number = digits.startsWith('55') ? digits : `55${digits}`
    return `https://wa.me/${number}`
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-120px)]">
      <div className="mb-4">
        <p className="eyebrow mb-1">Comunicação</p>
        <h1 className="text-2xl md:text-3xl font-display font-extrabold text-ink-900">Chat</h1>
      </div>

      <div className="flex gap-1 mb-3">
        <button
          onClick={() => setTab('colaboradores')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'colaboradores' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'}`}
        >
          <MessageCircle size={14} />
          Colaboradores
          {totalUnread > 0 && (
            <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">{totalUnread}</span>
          )}
        </button>
        <button
          onClick={() => setTab('interno')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'interno' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'}`}
        >
          <Users size={14} />
          Equipe interna
        </button>
      </div>

      {tab === 'colaboradores' ? (
        <div className="flex gap-3 flex-1 min-h-0 overflow-hidden">
          {/* Sidebar — no celular ocupa a tela toda; some quando abre uma conversa */}
          <div className={`w-full md:w-64 flex-shrink-0 card flex-col overflow-hidden p-0 ${selectedEmployee ? 'hidden md:flex' : 'flex'}`}>
            <div className="p-2 border-b border-gray-100 space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="input pl-8 text-sm py-1.5 w-full"
                  placeholder="Buscar colaborador..."
                  value={searchEmp}
                  onChange={e => setSearchEmp(e.target.value)}
                />
              </div>
              <button
                className="w-full flex items-center justify-center gap-1.5 text-xs text-primary-600 font-medium hover:bg-primary-50 rounded-lg py-1.5 transition-colors"
                onClick={() => { setShowNewConv(v => !v); setNewConvEmpId(''); setNewConvMsg('') }}
              >
                <Plus size={13} />
                Nova mensagem
              </button>
              {showNewConv && (
                <div className="bg-primary-50 rounded-xl p-3 space-y-2 border border-primary-100">
                  <select
                    className="input text-sm py-1 w-full"
                    value={newConvEmpId}
                    onChange={e => setNewConvEmpId(e.target.value)}
                  >
                    <option value="">Selecionar colaborador...</option>
                    {allEmployees?.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                  </select>
                  <textarea
                    className="input text-sm w-full resize-none"
                    rows={2}
                    placeholder="Mensagem..."
                    value={newConvMsg}
                    onChange={e => setNewConvMsg(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      className="btn-primary text-xs py-1 px-3 flex-1"
                      disabled={!newConvEmpId || !newConvMsg.trim() || sendAdminMessage.isPending}
                      onClick={() => { if (newConvEmpId && newConvMsg.trim()) sendAdminMessage.mutate({ employeeId: newConvEmpId, message: newConvMsg.trim() }) }}
                    >Enviar</button>
                    <button className="text-xs text-gray-400 hover:text-gray-600 p-1" onClick={() => setShowNewConv(false)}><X size={14} /></button>
                  </div>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {filteredThreads.length === 0 && (
                <div className="p-6 text-xs text-gray-400 text-center">
                  <MessageSquare size={24} className="mx-auto mb-2 text-gray-200" />
                  Nenhuma mensagem ainda
                </div>
              )}
              {filteredThreads.map(t => {
                const last = t.messages.at(-1)
                return (
                  <button
                    key={t.employee.id}
                    onClick={() => setSelectedEmployee(t.employee.id)}
                    className={`w-full text-left p-3 hover:bg-gray-50 transition-colors ${selectedEmployee === t.employee.id ? 'bg-primary-50 border-r-2 border-primary-500' : ''}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${t.unread > 0 ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                        {getInitials(t.employee.full_name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-0.5">
                          <p className="text-xs font-semibold text-gray-900 truncate">{t.employee.full_name.split(' ')[0]}</p>
                          {t.unread > 0 && (
                            <span className="w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center flex-shrink-0">{t.unread}</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 truncate">{last?.message || last?.answer || ''}</p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Conversa */}
          {selectedThread ? (
            <div className="flex-1 card flex flex-col overflow-hidden p-0">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
                <button onClick={() => setSelectedEmployee(null)} className="md:hidden -ml-1 p-1 text-gray-500 hover:text-gray-800 active:scale-95" aria-label="Voltar">
                  <ArrowLeft size={18} />
                </button>
                <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-sm flex-shrink-0">
                  {getInitials(selectedThread.employee.full_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-900">{selectedThread.employee.full_name}</p>
                  {waLink(selectedThread.employee.whatsapp) && (
                    <a
                      href={waLink(selectedThread.employee.whatsapp)!}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-green-600 hover:text-green-700 hover:underline flex items-center gap-1 w-fit"
                    >
                      <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current flex-shrink-0"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      Abrir WhatsApp
                    </a>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {selectedThread.messages.map(m => (
                  <div key={m.id} className="space-y-2">
                    {m.message && (
                      <div className="flex gap-2 items-end">
                        <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-600 flex-shrink-0">
                          {getInitials(selectedThread.employee.full_name)}
                        </div>
                        <div className="max-w-xs lg:max-w-md">
                          <div className="bg-gray-100 text-gray-900 px-3 py-2 rounded-2xl rounded-bl-sm text-sm">{m.message}</div>
                          <p className="text-xs text-gray-400 mt-0.5 px-1">{format(new Date(m.created_at), "d MMM 'às' HH:mm", { locale: ptBR })}</p>
                        </div>
                      </div>
                    )}
                    {m.answer && (
                      <div className="flex gap-2 items-end flex-row-reverse">
                        <div className="w-7 h-7 rounded-full bg-primary-600 flex items-center justify-center text-xs font-medium text-white flex-shrink-0">
                          RH
                        </div>
                        <div className="max-w-xs lg:max-w-md flex flex-col items-end">
                          <div className="bg-primary-600 text-white px-3 py-2 rounded-2xl rounded-br-sm text-sm">{m.answer}</div>
                          <p className="text-xs text-gray-400 mt-0.5 px-1">
                            {m.answered_at ? format(new Date(m.answered_at), "d MMM 'às' HH:mm", { locale: ptBR }) : ''}
                            {m.answered_by ? ` · ${m.answered_by}` : ''}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={threadEndRef} />
              </div>

              <div className="border-t border-gray-200 p-3 flex gap-2">
                <input
                  className="input flex-1 text-sm"
                  placeholder={selectedThread.messages.some(m => !m.answer && m.message) ? 'Responder...' : 'Enviar mensagem...'}
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
                />
                <button onClick={sendReply} disabled={!reply.trim()} className="btn-primary px-3">
                  <Send size={15} />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 card hidden md:flex items-center justify-center">
              <div className="text-center text-gray-400">
                <MessageCircle size={40} className="mx-auto mb-3 text-gray-200" />
                <p className="text-sm font-medium">Selecione um colaborador</p>
                <p className="text-xs mt-1">As mensagens enviadas pelo portal aparecem aqui</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="card flex-1 flex flex-col overflow-hidden p-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages?.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">Nenhuma mensagem ainda. Seja o primeiro!</div>
            )}
            {messages?.map(m => {
              const isOwn = m.user_id === user?.id
              return (
                <div key={m.id} className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 ${isOwn ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                    {getInitials((m as { user?: { full_name: string } }).user?.full_name || 'U')}
                  </div>
                  <div className={`max-w-xs lg:max-w-md flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                    <div className={`px-4 py-2 rounded-2xl text-sm ${isOwn ? 'bg-primary-600 text-white rounded-tr-sm' : 'bg-gray-100 text-gray-900 rounded-tl-sm'}`}>
                      {!isOwn && <p className="text-xs font-medium mb-1 text-gray-600">{(m as { user?: { full_name: string } }).user?.full_name}</p>}
                      <p>{m.content}</p>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5 px-1">{formatDate(m.created_at, 'HH:mm')}</p>
                  </div>
                </div>
              )
            })}
            <div ref={internalEndRef} />
          </div>
          <div className="border-t border-gray-200 p-3 flex gap-2">
            <input
              className="input flex-1"
              placeholder="Mensagem para a equipe..."
              value={internalMsg}
              onChange={e => setInternalMsg(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInternal() } }}
            />
            <button onClick={sendInternal} disabled={!internalMsg.trim() || sendingInternal} className="btn-primary px-4">
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
