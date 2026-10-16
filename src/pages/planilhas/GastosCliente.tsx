import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, FileDown, Download, Paperclip, X, Trash2, Building2, Receipt } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate, hojeISO } from '../../lib/utils'
import { getSignedUrl } from '../../lib/storage'
import { confirmar } from '../../components/ui/ConfirmDialog'
import { comprimirImagem, extensaoDoArquivo } from '../../lib/imagem'
import { baixarExcelBonito } from '../../lib/excelBonito'

/**
 * Gastos com o cliente (migração 096, pedido de 16/10/2026): escolhe o cliente,
 * lança cada gasto (nome, data, valor, observação, para quem, comprovante) e
 * gera o PDF com a tabela e a foto de cada comprovante.
 */
type Gasto = {
  id: string; client_id: string; data: string; nome: string; observacao: string | null; valor: number
  employee_id: string | null; comprovante_url: string | null
}
type Nome = { id: string; nome: string }

export default function GastosCliente({ mes, nomeMes }: { mes: string; nomeMes: string }) {
  const qc = useQueryClient()
  const [cliente, setCliente] = useState<string>(() => { try { return localStorage.getItem('gastos-cliente') || '' } catch { return '' } })
  const [periodo, setPeriodo] = useState<'mes' | 'tudo'>('mes')
  const [form, setForm] = useState<Partial<Gasto> | null>(null)
  const [gerando, setGerando] = useState<string | null>(null)
  const escolher = (id: string) => { setCliente(id); try { localStorage.setItem('gastos-cliente', id) } catch { /* sem armazenamento */ } }
  const ini = `${mes}-01`
  const fim = (() => { const [a, m] = mes.split('-').map(Number); return new Date(a, m, 0).toISOString().slice(0, 10) })()

  const { data: base } = useQuery({
    queryKey: ['gastos-cliente-base'],
    queryFn: async () => {
      const [c, e] = await Promise.all([
        supabase.from('clients').select('id, name').order('name'),
        supabase.from('employees').select('id, full_name, status').order('full_name'),
      ])
      return {
        clientes: (c.data || []).map(x => ({ id: x.id as string, nome: x.name as string })) as Nome[],
        pessoas: (e.data || []).map(x => ({ id: x.id as string, nome: x.full_name as string, ativo: x.status !== 'Inativo' })),
      }
    },
    staleTime: 5 * 60_000,
  })
  const { data: gastos = [], isLoading, error } = useQuery({
    queryKey: ['gastos-cliente', cliente, periodo, mes],
    enabled: !!cliente,
    queryFn: async () => {
      let q = supabase.from('gastos_cliente').select('*').eq('client_id', cliente).order('data').order('criado_em')
      if (periodo === 'mes') q = q.gte('data', ini).lte('data', fim)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return (data || []).map(g => ({ ...g, valor: Number(g.valor) })) as Gasto[]
    },
  })
  const semMigracao = error && /gastos_cliente/.test((error as Error).message)
  const nomeCliente = base?.clientes.find(c => c.id === cliente)?.nome || ''
  const nomePessoa = useMemo(() => new Map((base?.pessoas || []).map(p => [p.id, p.nome])), [base])
  const total = gastos.reduce((t, g) => t + g.valor, 0)
  const semComprovante = gastos.filter(g => !g.comprovante_url).length
  const rotuloPeriodo = periodo === 'mes' ? nomeMes : 'Todos os meses'

  const gerarPdf = async () => {
    setGerando('Preparando…')
    try {
      const { gerarPdfGastosCliente } = await import('../../lib/gastosClientePdf')
      const blob = await gerarPdfGastosCliente(nomeCliente, rotuloPeriodo.replace(/^./, c => c.toUpperCase()),
        gastos.map(g => ({ ...g, pessoa: g.employee_id ? nomePessoa.get(g.employee_id) : null })), t => setGerando(t))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `gastos_${nomeCliente.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').toLowerCase()}_${periodo === 'mes' ? mes : 'todos'}.pdf`
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast.success('PDF gerado')
    } catch (e) { toast.error('Não gerou o PDF: ' + (e as Error).message) }
    setGerando(null)
  }
  const baixarExcel = () => baixarExcelBonito(`gastos_${periodo === 'mes' ? mes : 'todos'}`, [{
    nome: 'Gastos', titulo: `Gastos com o cliente · ${nomeCliente}`, subtitulo: `${rotuloPeriodo} · ${gastos.length} gasto(s)`,
    colunas: [{ titulo: 'Data', largura: 12, tipo: 'data' }, { titulo: 'Gasto', largura: 28 }, { titulo: 'Observação', largura: 40, tipo: 'texto' },
      { titulo: 'Para quem', largura: 24 }, { titulo: 'Valor', largura: 14, tipo: 'dinheiro' }, { titulo: 'Comprovante', largura: 16, tipo: 'centro' }],
    linhas: gastos.map(g => [formatDate(g.data), g.nome, g.observacao || '', g.employee_id ? nomePessoa.get(g.employee_id) || '' : '', g.valor, g.comprovante_url ? 'Anexado' : 'Sem comprovante']),
    cores: gastos.map(g => (g.comprovante_url ? null : 'amarelo')),
    total: ['Total', '', '', '', total, ''],
  }]).catch(e => toast.error('Não gerou: ' + e.message))

  if (semMigracao) return <div className="card p-4 text-sm text-amber-800 bg-amber-50 border-amber-200">Para usar os gastos do cliente, rode a migração 096 no Supabase.</div>

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <label className="label flex items-center gap-1.5"><Building2 size={14} />Cliente</label>
        <select className="input" value={cliente} onChange={e => escolher(e.target.value)}>
          <option value="">Escolha o cliente…</option>
          {(base?.clientes || []).map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        {cliente && (
          <div className="flex gap-1 p-1 rounded-xl bg-ink-100/70 w-fit">
            {([['mes', nomeMes], ['tudo', 'Todos os meses']] as const).map(([k, t]) => (
              <button key={k} onClick={() => setPeriodo(k)} className={`px-3 h-8 rounded-lg text-sm font-medium first-letter:uppercase ${periodo === k ? 'bg-white shadow-sm text-ink-900' : 'text-ink-500'}`}>{t}</button>
            ))}
          </div>
        )}
      </div>

      {!cliente ? (
        <div className="card p-8 text-center text-sm text-ink-500">Escolha o cliente para ver e lançar os gastos.</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="card px-3 py-2.5"><p className="text-[11px] text-ink-500">Total</p><p className="text-lg font-semibold tnum text-ink-900">{formatCurrency(total)}</p></div>
            <div className="card px-3 py-2.5"><p className="text-[11px] text-ink-500">Gastos</p><p className="text-lg font-semibold tnum text-ink-900">{gastos.length}</p></div>
            <div className="card px-3 py-2.5"><p className="text-[11px] text-ink-500">Sem comprovante</p><p className={`text-lg font-semibold tnum ${semComprovante ? 'text-amber-700' : 'text-ink-400'}`}>{semComprovante}</p></div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn-primary text-sm" onClick={() => setForm({ client_id: cliente, data: periodo === 'mes' && !hojeISO().startsWith(mes) ? ini : hojeISO() })}><Plus size={15} />Lançar gasto</button>
            <button className="btn-secondary text-sm" disabled={!gastos.length || !!gerando} onClick={gerarPdf}><FileDown size={15} />{gerando || 'Gerar PDF com comprovantes'}</button>
            <button className="btn-secondary text-sm" disabled={!gastos.length} onClick={baixarExcel}><Download size={15} />Excel</button>
          </div>

          {isLoading ? <p className="text-sm text-ink-500">Carregando…</p> : gastos.length === 0 ? (
            <div className="card p-8 text-center text-sm text-ink-500">Nenhum gasto de {nomeCliente} {periodo === 'mes' ? `em ${nomeMes}` : 'ainda'}. Toque em <b>Lançar gasto</b>.</div>
          ) : (
            <div className="card overflow-hidden divide-y divide-ink-100">
              {gastos.map(g => (
                <button key={g.id} onClick={() => setForm(g)} className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-ink-50/60">
                  <span className="w-9 h-9 rounded-lg bg-ink-100 text-ink-600 flex items-center justify-center shrink-0"><Receipt size={16} /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-900 truncate">{g.nome}</p>
                    <p className="text-xs text-ink-500 truncate">{formatDate(g.data)}{g.employee_id ? ` · ${nomePessoa.get(g.employee_id) || ''}` : ''}{g.observacao ? ` · ${g.observacao}` : ''}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tnum text-ink-900">{formatCurrency(g.valor)}</p>
                    <p className={`text-[11px] ${g.comprovante_url ? 'text-green-700' : 'text-amber-700'}`}>{g.comprovante_url ? <><Paperclip size={10} className="inline -mt-0.5" /> comprovante</> : 'sem comprovante'}</p>
                  </div>
                </button>
              ))}
              <div className="px-4 py-2.5 bg-ink-50 flex justify-between text-sm font-semibold text-ink-800"><span>Total</span><span className="tnum">{formatCurrency(total)}</span></div>
            </div>
          )}
        </>
      )}

      {form && base && <FormGasto inicial={form} pessoas={base.pessoas} cliente={nomeCliente}
        fechar={() => setForm(null)} salvo={() => { setForm(null); qc.invalidateQueries({ queryKey: ['gastos-cliente'] }) }} />}
    </div>
  )
}

function FormGasto({ inicial, pessoas, cliente, fechar, salvo }: {
  inicial: Partial<Gasto>; pessoas: { id: string; nome: string; ativo: boolean }[]; cliente: string; fechar: () => void; salvo: () => void
}) {
  const editando = !!inicial.id
  const [f, setF] = useState<Partial<Gasto>>(inicial)
  const [valorTxt, setValorTxt] = useState(inicial.valor != null ? inicial.valor.toFixed(2).replace('.', ',') : '')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [salvando, setSalvando] = useState(false)
  const arqRef = useRef<HTMLInputElement>(null)
  const muda = (m: Partial<Gasto>) => setF(x => ({ ...x, ...m }))
  const valor = Number(valorTxt.includes(',') ? valorTxt.replace(/\./g, '').replace(',', '.') : valorTxt)
  const falta = !f.nome?.trim() ? 'Informe o nome do gasto.' : !f.data ? 'Informe a data.' : !(valor > 0) ? 'Informe o valor.' : ''

  const salvar = async () => {
    if (falta) { toast.error(falta); return }
    setSalvando(true)
    try {
      const linha = { client_id: f.client_id, data: f.data, nome: f.nome!.trim(), observacao: f.observacao?.trim() || null, valor: Math.round(valor * 100) / 100, employee_id: f.employee_id || null }
      let id = f.id
      if (editando) {
        const { error } = await supabase.from('gastos_cliente').update(linha).eq('id', id!)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('gastos_cliente').insert(linha).select('id').single()
        if (error) throw error
        id = data.id
      }
      if (arquivo && id) {
        const file = await comprimirImagem(arquivo)
        const caminho = `gastos_cliente/${f.client_id}/${id}_${Date.now()}.${extensaoDoArquivo(file)}`
        const { error: eUp } = await supabase.storage.from('arquivos').upload(caminho, file, { upsert: false, contentType: file.type || undefined })
        if (eUp) throw new Error('O gasto foi salvo, mas o comprovante não subiu: ' + eUp.message)
        const { error: e2 } = await supabase.from('gastos_cliente').update({ comprovante_url: caminho }).eq('id', id)
        if (e2) throw e2
      }
      toast.success(editando ? 'Gasto salvo' : 'Gasto lançado')
      salvo()
    } catch (e) {
      const m = (e as Error).message
      toast.error(/gastos_cliente/.test(m) && /exist|schema/.test(m) ? 'Rode a migração 096 no Supabase.' : 'Não salvou: ' + m)
    }
    setSalvando(false)
  }
  const excluir = async () => {
    if (!(await confirmar({ titulo: 'Excluir este gasto?', texto: `${f.nome} · ${formatCurrency(valor || 0)}`, confirmar: 'Excluir', perigo: true }))) return
    const { error } = await supabase.from('gastos_cliente').delete().eq('id', f.id!)
    if (error) { toast.error(error.message); return }
    if (f.comprovante_url) supabase.storage.from('arquivos').remove([f.comprovante_url])
    toast.success('Gasto excluído'); salvo()
  }
  const verComprovante = async () => { const u = await getSignedUrl(f.comprovante_url!, 'arquivos'); if (u) window.open(u, '_blank') }

  return (
    <div className="modal-overlay" onClick={fechar}>
      <div className="modal-box max-w-md space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-ink-900">{editando ? 'Gasto' : 'Lançar gasto'}</h3>
            <p className="text-xs text-ink-500">{cliente}</p>
          </div>
          <button onClick={fechar} className="p-2 -mr-2 text-ink-400" aria-label="Fechar"><X size={18} /></button>
        </div>
        <div><label className="label">Nome do gasto *</label>
          <input className="input" value={f.nome || ''} onChange={e => muda({ nome: e.target.value })} placeholder="Ex.: Airbnb da equipe" autoFocus={!editando} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Data *</label><input className="input" type="date" value={f.data || ''} onChange={e => muda({ data: e.target.value })} /></div>
          <div><label className="label">Valor *</label>
            <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">R$</span>
              <input className="input pl-9 tnum" inputMode="decimal" value={valorTxt} onChange={e => setValorTxt(e.target.value.replace(/[^\d,.]/g, ''))} placeholder="0,00" /></div></div>
        </div>
        <div><label className="label">Observação</label>
          <textarea className="input" rows={2} value={f.observacao || ''} onChange={e => muda({ observacao: e.target.value })} placeholder="O que é, por que precisou…" /></div>
        <div><label className="label">Para quem <span className="font-normal text-ink-400">— opcional</span></label>
          <select className="input" value={f.employee_id || ''} onChange={e => muda({ employee_id: e.target.value || null })}>
            <option value="">Ninguém específico</option>
            {pessoas.filter(p => p.ativo || p.id === f.employee_id).map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select></div>
        <div>
          <label className="label">Comprovante</label>
          <div className="flex items-center gap-2 flex-wrap">
            {f.comprovante_url && !arquivo && <button type="button" className="btn-secondary text-sm" onClick={verComprovante}><Paperclip size={14} />Ver comprovante</button>}
            <button type="button" className="btn-ghost text-sm border border-dashed border-ink-300" onClick={() => arqRef.current?.click()}>
              <Paperclip size={14} />{arquivo ? arquivo.name.slice(0, 28) : f.comprovante_url ? 'Trocar' : 'Anexar foto ou PDF'}
            </button>
            {arquivo && <button type="button" className="text-xs text-ink-500 underline" onClick={() => setArquivo(null)}>tirar</button>}
            <input ref={arqRef} type="file" accept="image/*,application/pdf,.pdf" className="hidden" onChange={e => setArquivo(e.target.files?.[0] || null)} />
          </div>
        </div>
        <div className="flex gap-2">
          {editando && <button className="btn-ghost text-red-600 text-sm mr-auto" onClick={excluir}><Trash2 size={15} />Excluir</button>}
          <button className="btn-secondary flex-1" onClick={fechar}>Cancelar</button>
          <button className="btn-primary flex-1" disabled={salvando || !!falta} onClick={salvar}>{salvando ? 'Salvando…' : editando ? 'Salvar' : 'Lançar'}</button>
        </div>
      </div>
    </div>
  )
}
