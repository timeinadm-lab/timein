import { useQuery } from '@tanstack/react-query'
import { HardDrive } from 'lucide-react'
import { supabase } from '../../lib/supabase'

/**
 * Medidor de espaço do plano gratuito do Supabase (pedido do Gabriel, 01/10/2026).
 * Arquivos: 1 GB · Banco: 500 MB. Passando do limite o Supabase pode restringir
 * o projeto inteiro (sistema e portal param), então avisa antes: laranja a
 * partir de 70%, vermelho a partir de 90%. Dados da migração 074.
 */

// Conta em GB "decimal" (o menor dos dois jeitos): avisa um pouco antes, nunca depois
export const LIMITE_ARQUIVOS = 1_000_000_000
export const LIMITE_BANCO = 500_000_000

export type UsoDoSistema = {
  banco_bytes: number
  arquivos_bytes: number
  arquivos_qtd: number
  ultimos_30_dias_bytes: number
  por_pasta: { pasta: string; bytes: number; qtd: number }[]
}

export function useUsoDoSistema(ativo = true) {
  return useQuery({
    queryKey: ['uso-sistema'],
    enabled: ativo,
    staleTime: 10 * 60_000,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('uso_do_sistema')
      if (error) throw error
      return data as UsoDoSistema
    },
  })
}

export const porcento = (usado: number, limite: number) => Math.min(100, Math.round((usado / limite) * 1000) / 10)
export function tamanho(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(0, Math.round(bytes / 1000))} KB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: bytes < 10_000_000 ? 1 : 0 })} MB`
  return `${(bytes / 1_000_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB`
}
const cor = (p: number) => (p >= 90 ? 'bg-red-600' : p >= 70 ? 'bg-amber-500' : 'bg-green-600')
const corTexto = (p: number) => (p >= 90 ? 'text-red-600' : p >= 70 ? 'text-amber-700' : 'text-green-700')

const NOMES_PASTA: Record<string, string> = {
  'arquivos/relatorios': 'Relatórios das visitas',
  'arquivos/receipts': 'Comprovantes de reembolso',
  'arquivos/atestados': 'Atestados',
  'arquivos/jornadas': 'PDFs da Jornada',
  'arquivos/contratos': 'Contratos',
  'arquivos/documentos': 'Documentos',
}
const nomeDaPasta = (p: string) => NOMES_PASTA[p]
  || (p.startsWith('fotos de funcionários/') ? 'Fotos dos colaboradores' : p.replace('/', ' › ').replace('(raiz)', 'outros'))

function Barra({ rotulo, usado, limite }: { rotulo: string; usado: number; limite: number }) {
  const p = porcento(usado, limite)
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink-700">{rotulo}</span>
        <span className="text-sm tnum">
          <strong className="text-ink-900">{tamanho(usado)}</strong>
          <span className="text-ink-400"> de {tamanho(limite)} · </span>
          <strong className={corTexto(p)}>{p.toLocaleString('pt-BR')}%</strong>
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-ink-100 overflow-hidden">
        <div className={`h-2.5 rounded-full transition-all ${cor(p)}`} style={{ width: `${Math.max(p, p > 0 ? 1 : 0)}%` }} />
      </div>
    </div>
  )
}

export default function MedidorEspaco() {
  const { data, isLoading, error } = useUsoDoSistema()

  return (
    <section className="min-w-0">
      <div className="flex items-center justify-between mb-2">
        <h2 className="section-title flex items-center gap-2"><HardDrive size={16} className="text-ink-400" />Espaço do sistema</h2>
        <span className="text-xs text-ink-400">plano gratuito do Supabase</span>
      </div>
      <div className="card p-4 space-y-4">
        {error ? (
          <p className="text-sm text-amber-700">Para ver o medidor, rode a migração 074 no Supabase.</p>
        ) : isLoading || !data ? (
          <p className="text-sm text-ink-500">Medindo…</p>
        ) : (() => {
          const livre = Math.max(0, LIMITE_ARQUIVOS - data.arquivos_bytes)
          const ritmo = data.ultimos_30_dias_bytes
          const meses = ritmo > 0 ? livre / ritmo : null
          const pArq = porcento(data.arquivos_bytes, LIMITE_ARQUIVOS)
          return (
            <>
              <Barra rotulo="Arquivos (relatórios, comprovantes, contratos, fotos)" usado={data.arquivos_bytes} limite={LIMITE_ARQUIVOS} />
              <Barra rotulo="Banco de dados (registros)" usado={data.banco_bytes} limite={LIMITE_BANCO} />

              <div className={`rounded-xl px-3 py-2.5 text-xs ${pArq >= 90 ? 'bg-red-50 text-red-800' : pArq >= 70 ? 'bg-amber-50 text-amber-900' : 'bg-ink-50 text-ink-700'}`}>
                {ritmo > 0 ? (
                  <>Nos últimos 30 dias entraram <strong>{tamanho(ritmo)}</strong> de arquivos.{' '}
                    {meses != null && meses < 1
                      ? <strong>Nesse ritmo, o espaço acaba em menos de 1 mês.</strong>
                      : meses != null && <>Nesse ritmo, o espaço de arquivos acaba em <strong>~{Math.floor(meses)} {Math.floor(meses) === 1 ? 'mês' : 'meses'}</strong>.</>}
                  </>
                ) : <>Nenhum arquivo novo nos últimos 30 dias.</>}
                {pArq >= 90 && <> Passando de 100% o Supabase pode parar o sistema e o portal.</>}
              </div>

              {data.por_pasta.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-ink-500 uppercase tracking-wide">O que mais ocupa · {data.arquivos_qtd} arquivo{data.arquivos_qtd !== 1 ? 's' : ''}</p>
                  {data.por_pasta.slice(0, 5).map(p => (
                    <div key={p.pasta} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-ink-600 truncate">{nomeDaPasta(p.pasta)} <span className="text-ink-400">· {p.qtd}</span></span>
                      <span className="text-ink-800 tnum shrink-0">{tamanho(p.bytes)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )
        })()}
      </div>
    </section>
  )
}
