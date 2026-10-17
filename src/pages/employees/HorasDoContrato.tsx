import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { format, startOfWeek, addDays } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { hojeISO } from '../../lib/utils'
import { minutosLiquidos } from '../../lib/jornada'

/**
 * Consultor fixo — horas por semana do CONTRATO (migração 097, pedido de
 * 17/10/2026). Total do contrato (ex.: 40h) e, se quiser, quanto vai para
 * cada cliente (ex.: 5h no X, 10h no Y). O que não for dividido fica em
 * aberto: ela escolhe para qual cliente vai. Mostra quanto já fez na semana.
 */
type ClienteDoContrato = { id: string; client_id: string | null; nome: string; horas_semana?: number | null; contrato_horas_semana?: number | null; break_minutes?: number | null }

const h = (n: number) => `${String(Math.round(n * 10) / 10).replace('.', ',')}h`
const hm = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(Math.round(min % 60)).padStart(2, '0') : ''}`
const num = (t: string) => Number(t.replace(',', '.'))

export default function HorasDoContrato({ employeeId, principalId, clientes }: { employeeId: string; principalId: string; clientes: ClienteDoContrato[] }) {
  const qc = useQueryClient()
  const total = Number(clientes.find(c => c.id === principalId)?.contrato_horas_semana) || Math.max(0, ...clientes.map(c => Number(c.contrato_horas_semana) || 0))
  const divididas = clientes.reduce((t, c) => t + (Number(c.horas_semana) || 0), 0)
  const emAberto = Math.max(0, total - divididas)
  const [editTotal, setEditTotal] = useState<string | null>(null)
  const [editCli, setEditCli] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState(false)

  // Esta semana (segunda a domingo), somando todos os clientes do contrato
  const seg = format(startOfWeek(new Date(hojeISO() + 'T12:00:00'), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const dom = format(addDays(new Date(seg + 'T12:00:00'), 6), 'yyyy-MM-dd')
  const { data: semana } = useQuery({
    queryKey: ['horas-contrato-semana', employeeId, seg],
    queryFn: async () => {
      const { data, error } = await supabase.from('nutritionist_visits')
        .select('client_id, visit_date, check_in, check_out, break_start, break_end, is_unavailable, is_holiday')
        .eq('employee_id', employeeId).gte('visit_date', seg).lte('visit_date', dom)
      if (error) throw error
      return data || []
    },
  })
  const minDoCliente = (cid: string | null) => (semana || [])
    .filter(r => r.client_id === cid && r.check_in && !r.is_unavailable && !r.is_holiday)
    .reduce((t, r) => t + minutosLiquidos(r, clientes.find(c => c.client_id === cid)?.break_minutes), 0)
  const feitoMin = clientes.reduce((t, c) => t + minDoCliente(c.client_id), 0)
  const pct = total ? Math.min(100, Math.round((feitoMin / 60 / total) * 100)) : 0

  const erroMigracao = (m: string) => /contrato_horas_semana|horas_semana/.test(m) ? 'Rode a migração 097 no Supabase para guardar as horas do contrato.' : m
  const salvarTotal = async () => {
    const v = editTotal?.trim() ? num(editTotal) : null
    if (v !== null && !(v > 0 && v <= 80)) { toast.error('Informe as horas por semana (até 80).'); return }
    setSalvando(true)
    const { error } = await supabase.from('employee_client_links').update({ contrato_horas_semana: v }).eq('id', principalId)
    if (!error) await supabase.from('employee_client_links').update({ contrato_horas_semana: null }).in('id', clientes.filter(c => c.id !== principalId).map(c => c.id))
    setSalvando(false)
    if (error) { toast.error(erroMigracao(error.message)); return }
    toast.success(v ? `Contrato: ${h(v)} por semana` : 'Horas do contrato tiradas')
    setEditTotal(null); qc.invalidateQueries({ queryKey: ['employee-links', employeeId] })
  }
  const salvarCliente = async (c: ClienteDoContrato) => {
    const txt = editCli[c.id]
    if (txt === undefined) return
    const v = txt.trim() ? num(txt) : null
    if (v !== null && !(v > 0 && v <= 80)) { toast.error('Horas inválidas'); return }
    if ((v || 0) === (Number(c.horas_semana) || 0)) { setEditCli(p => { const n = { ...p }; delete n[c.id]; return n }); return }
    const outros = divididas - (Number(c.horas_semana) || 0)
    if (total && v && outros + v > total) toast(`Atenção: a divisão passa do total do contrato (${h(outros + v)} de ${h(total)}).`, { icon: '⚠️' })
    const { error } = await supabase.from('employee_client_links').update({ horas_semana: v }).eq('id', c.id)
    if (error) { toast.error(erroMigracao(error.message)); return }
    setEditCli(p => { const n = { ...p }; delete n[c.id]; return n })
    qc.invalidateQueries({ queryKey: ['employee-links', employeeId] })
  }

  return (
    <div className="rounded-lg bg-white border border-ink-200 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-xs text-ink-500">Horas por semana do contrato</p>
          {editTotal === null ? (
            <button className="flex items-baseline gap-2" onClick={() => setEditTotal(total ? String(total).replace('.', ',') : '')}>
              <span className="text-base font-semibold text-ink-900 tnum">{total ? `${h(total)} por semana` : 'Definir'}</span>
              <span className="text-xs text-primary-700">editar</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 mt-0.5">
              <input className="input text-sm w-20 py-1" inputMode="decimal" autoFocus value={editTotal} onChange={e => setEditTotal(e.target.value.replace(/[^\d,.]/g, ''))} placeholder="Ex.: 40" />
              <span className="text-xs text-ink-500">h/semana</span>
              <button className="btn-primary text-xs py-1" disabled={salvando} onClick={salvarTotal}>Salvar</button>
              <button className="text-xs text-ink-500 px-1" onClick={() => setEditTotal(null)}>✕</button>
            </div>
          )}
        </div>
        {total > 0 && (
          <div className="text-right">
            <p className="text-[11px] text-ink-500">Esta semana ({seg.slice(8, 10)}/{seg.slice(5, 7)} a {dom.slice(8, 10)}/{dom.slice(5, 7)})</p>
            <p className={`text-sm font-semibold tnum ${feitoMin / 60 >= total ? 'text-green-700' : 'text-ink-900'}`}>{hm(feitoMin)} de {h(total)}</p>
          </div>
        )}
      </div>
      {total > 0 && <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden"><div className="h-1.5 bg-primary-600 rounded-full" style={{ width: `${pct}%` }} /></div>}

      {total > 0 && (
        <>
          <p className="text-[11px] text-ink-500">
            Divida por cliente se quiser. Vazio = em aberto (ela escolhe para qual cliente vai). Divididas <b>{h(divididas)}</b> · em aberto <b>{h(emAberto)}</b>
            {divididas > total && <span className="text-amber-700 font-semibold"> · a divisão passa do total</span>}
          </p>
          <div className="divide-y divide-ink-100 border border-ink-100 rounded-lg">
            {clientes.map(c => {
              const feito = minDoCliente(c.client_id)
              const meta = Number(c.horas_semana) || 0
              return (
                <div key={c.id} className="flex items-center gap-2 px-2.5 py-1.5">
                  <p className="flex-1 min-w-0 text-sm text-ink-800 truncate">{c.nome}</p>
                  <span className="text-[11px] text-ink-500 tnum shrink-0">{feito ? `fez ${hm(feito)}` : ''}</span>
                  <input className={`w-16 h-8 rounded-md border px-2 text-right text-sm tnum ${meta ? 'border-ink-200 text-ink-900' : 'border-dashed border-ink-300 text-ink-400'}`}
                    inputMode="decimal" placeholder="aberto" value={editCli[c.id] ?? (meta ? String(meta).replace('.', ',') : '')}
                    onChange={e => setEditCli(p => ({ ...p, [c.id]: e.target.value.replace(/[^\d,.]/g, '') }))}
                    onBlur={() => salvarCliente(c)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                  <span className="text-[11px] text-ink-500 w-6">h/sem</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
