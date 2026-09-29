import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Paperclip, AlertTriangle, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { formatDate, hojeISO } from '../../lib/utils'
import { SignedLink } from '../../components/ui/SignedFile'

export const QUEM_ENCERROU: Record<string, string> = {
  cliente: 'Cliente rompeu',
  nutricionista: 'Nutricionista pediu para sair',
  tin: 'TIN desligou',
  acordo: 'Acordo entre as partes',
}

export type VinculoParaEncerrar = {
  id: string
  employee_id?: string
  client_id?: string
  service_type?: string
  pay_mode?: string | null
  start_date?: string | null
  contract_end_date?: string | null
  ended_at?: string | null
  end_initiated_by?: string | null
  end_reason?: string | null
  end_document_url?: string | null
  end_fine_amount?: number | null
  end_fine_description?: string | null
  client?: { name?: string } | null
}

/**
 * Encerramento (rescisão) de um vínculo. Nada é apagado: visitas, agenda,
 * pagamentos e documentos continuam ligados ao vínculo. Registra o último dia,
 * quem encerrou, o motivo, o distrato e a multa (opcional). O acerto é feito
 * em Pagamentos, na linha do vínculo no mês do encerramento.
 */
export default function EncerrarVinculoModal({ vinculo, employeeId, nome, onClose, onSaved }: {
  vinculo: VinculoParaEncerrar
  employeeId: string
  nome: string
  onClose: () => void
  onSaved: () => void
}) {
  const editando = !!vinculo.ended_at
  const [fim, setFim] = useState(vinculo.contract_end_date || hojeISO())
  const [quem, setQuem] = useState(vinculo.end_initiated_by || '')
  const [motivo, setMotivo] = useState(vinculo.end_reason || '')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [comMulta, setComMulta] = useState(!!vinculo.end_fine_amount)
  const [multa, setMulta] = useState(vinculo.end_fine_amount ? String(vinculo.end_fine_amount) : '')
  const [multaDesc, setMultaDesc] = useState(vinculo.end_fine_description || '')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  // Registros de ponto no mês do encerramento, até o último dia — para o RH
  // ver na hora se a folha está preenchida (o acerto depende disso)
  const inicioMes = fim ? fim.slice(0, 8) + '01' : ''
  const desde = vinculo.start_date && vinculo.start_date > inicioMes ? vinculo.start_date : inicioMes
  const { data: registros } = useQuery({
    queryKey: ['encerrar-registros', vinculo.id, fim],
    enabled: !!fim && !!vinculo.client_id,
    queryFn: async () => {
      const { data, error } = await supabase.from('nutritionist_visits')
        .select('visit_date, check_out, is_unavailable, is_holiday')
        .eq('employee_id', employeeId).eq('client_id', vinculo.client_id!)
        .gte('visit_date', desde).lte('visit_date', fim)
      if (error) throw error
      return data || []
    },
  })
  const trabalhados = (registros || []).filter(r => r.check_out && !r.is_unavailable && !r.is_holiday).length
  const semSaida = (registros || []).filter(r => !r.check_out && !r.is_unavailable && !r.is_holiday).length
  // Consultoria com salário fixo acerta como fixo (dias corridos × salário ÷ 30), igual à folha
  const porTrabalho = vinculo.service_type === 'Consultoria' && vinculo.pay_mode !== 'salario_fixo'

  const salvar = async () => {
    if (!fim) { toast.error('Informe o último dia trabalhado'); return }
    if (vinculo.start_date && fim < vinculo.start_date) { toast.error('O último dia não pode ser antes do início do vínculo'); return }
    if (!quem) { toast.error('Diga quem encerrou'); return }
    const valorMulta = comMulta ? Number(String(multa).replace(',', '.')) : 0
    if (comMulta && !(valorMulta > 0)) { toast.error('Informe o valor da multa ou desmarque a opção'); return }

    setSalvando(true)
    try {
      let docPath = vinculo.end_document_url || null
      if (arquivo) {
        const ext = arquivo.name.split('.').pop() || 'pdf'
        const path = `distratos/${employeeId}/${vinculo.id}.${ext}`
        const { error: upErr } = await supabase.storage.from('arquivos').upload(path, arquivo, { upsert: true })
        if (upErr) throw new Error('Não consegui enviar o distrato: ' + upErr.message)
        docPath = path
      }
      const { data: u } = await supabase.auth.getUser()
      const { error } = await supabase.from('employee_client_links').update({
        contract_end_date: fim,
        ended_at: vinculo.ended_at || new Date().toISOString(),
        ended_by: u.user?.id ?? null,
        end_initiated_by: quem,
        end_reason: motivo.trim() || null,
        end_document_url: docPath,
        end_fine_amount: comMulta ? valorMulta : null,
        end_fine_description: comMulta ? (multaDesc.trim() || null) : null,
      }).eq('id', vinculo.id)
      if (error) {
        if (/ended_at|end_initiated_by|column/i.test(error.message)) throw new Error('Falta rodar a migração 057 no Supabase.')
        throw error
      }
      toast.success(editando ? 'Encerramento atualizado' : `Contrato encerrado em ${formatDate(fim)}. Nada foi apagado.`)
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box max-w-lg space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-ink-400 truncate">{nome} · {vinculo.client?.name || 'Cliente'}</p>
            <h3 className="text-lg font-semibold text-ink-900">{editando ? 'Encerramento do contrato' : 'Encerrar contrato'}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-ink-400 hover:bg-ink-100" aria-label="Fechar"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Último dia trabalhado *</label>
            <input type="date" className="input" value={fim} min={vinculo.start_date || undefined} onChange={e => setFim(e.target.value)} />
          </div>
          <div>
            <label className="label">Quem encerrou *</label>
            <select className="input" value={quem} onChange={e => setQuem(e.target.value)}>
              <option value="">Selecione…</option>
              {Object.entries(QUEM_ENCERROU).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Motivo</label>
          <textarea className="input" rows={2} value={motivo} onChange={e => setMotivo(e.target.value)}
            placeholder="Ex.: cliente encerrou o projeto antes do prazo" />
        </div>

        <div>
          <label className="label">Distrato assinado <span className="text-ink-400 font-normal">(opcional)</span></label>
          {vinculo.end_document_url && !arquivo && (
            <SignedLink value={vinculo.end_document_url} bucket="arquivos" className="inline-flex items-center gap-1.5 text-sm text-primary-700 hover:underline mb-1.5">
              <Paperclip size={14} /> Ver distrato anexado
            </SignedLink>
          )}
          <label className="flex items-center gap-2 border border-dashed border-ink-300 rounded-lg px-3 py-2.5 text-sm text-ink-600 cursor-pointer hover:bg-ink-50">
            <Paperclip size={15} className="text-ink-400" />
            <span className="truncate">{arquivo ? arquivo.name : vinculo.end_document_url ? 'Trocar arquivo' : 'Anexar PDF'}</span>
            <span className="text-ink-400 text-xs ml-auto shrink-0">opcional</span>
            <input type="file" accept=".pdf,image/*" className="hidden" onChange={e => setArquivo(e.target.files?.[0] || null)} />
          </label>
        </div>

        <div className="rounded-lg border border-ink-200 p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm text-ink-800 cursor-pointer select-none">
            <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-primary-700" checked={comMulta} onChange={e => setComMulta(e.target.checked)} />
            Aplicar multa ou indenização <span className="text-ink-400 text-xs">(opcional)</span>
          </label>
          {comMulta && (
            <div className="grid grid-cols-1 sm:grid-cols-[8rem_1fr] gap-2">
              <input className="input" type="number" inputMode="decimal" min={0} step="0.01" placeholder="Valor R$" value={multa} onChange={e => setMulta(e.target.value)} />
              <input className="input" placeholder="Descrição (ex.: cláusula 8ª)" value={multaDesc} onChange={e => setMultaDesc(e.target.value)} />
            </div>
          )}
          {comMulta && <p className="text-xs text-ink-400">Entra no acerto, em Pagamentos, somada ao que ela trabalhou.</p>}
        </div>

        {/* Folha ponto até o último dia */}
        {fim && (
          <div className={`rounded-lg px-3 py-2.5 text-xs flex items-start gap-2 ${semSaida > 0 ? 'bg-amber-50 text-amber-900' : 'bg-ink-50 text-ink-700'}`}>
            {semSaida > 0 ? <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600" /> : <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-ink-400" />}
            <span>
              {porTrabalho
                ? <>Visitas registradas de {formatDate(desde)} até {formatDate(fim)}: <strong>{trabalhados}</strong>. O acerto é a soma dessas visitas.</>
                : <>Dias registrados na folha ponto de {formatDate(desde)} até {formatDate(fim)}: <strong>{trabalhados}</strong>.
                  {' '}O acerto é dias corridos × salário ÷ 30 — e <strong>só fecha com a folha ponto completa</strong> até o último dia.</>}
              {semSaida > 0 && <> {semSaida} registro{semSaida > 1 ? 's' : ''} sem horário de saída.</>}
            </span>
          </div>
        )}

        <p className="text-xs text-ink-500 leading-relaxed">
          Nada é apagado: visitas, agenda, pagamentos e documentos continuam no vínculo. O portal deixa de aceitar
          registros neste cliente depois do último dia. O acerto aparece em <strong>Pagamentos</strong>, no mês do encerramento.
          O status da pessoa não muda.
        </p>

        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className={editando ? 'btn-primary' : 'btn-danger'} onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Encerrar contrato'}
          </button>
        </div>
      </div>
    </div>
  )
}
