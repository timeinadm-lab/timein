import { useEffect, useState } from 'react'

// Horário em bloco grande. Vazio mostra --:-- (o campo do iPhone mostrava a hora
// atual como se já estivesse preenchido). O seletor nativo fica por cima, invisível.
// iPhone: com o campo vazio, o relógio abre na hora atual, mas tocar em OK sem girar
// não grava nada — quem marca a entrada na hora em que chegou ficava sem horário.
// Por isso, ao abrir vazio, o campo já recebe a hora atual (e dá para girar e mudar).
// Celular sem relógio nativo, ou relógio que não abre: vira campo de digitar (0830 → 08:30).
export const temRelogioNativo = (() => {
  try { const i = document.createElement('input'); i.setAttribute('type', 'time'); return i.type === 'time' } catch { return false }
})()
export const horaAgora = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
function mascaraHora(t: string): string {
  const n = t.replace(/\D/g, '').slice(0, 4)
  return n.length <= 2 ? n : `${n.slice(0, 2)}:${n.slice(2)}`
}
function horaValida(t: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(t)
  return !!m && +m[1] < 24 && +m[2] < 60
}

export function CampoHora({ rotulo, valor, onChange, digitar }: { rotulo: string; valor: string; onChange: (v: string) => void; digitar?: boolean }) {
  const [texto, setTexto] = useState(valor)
  useEffect(() => { setTexto(valor) }, [valor])
  if (digitar || !temRelogioNativo) {
    const invalido = texto.length === 5 && !horaValida(texto)
    return (
      <label className={`relative flex-1 min-w-0 block rounded-xl border bg-white px-4 py-3 ${invalido ? 'border-red-400' : valor ? 'border-ink-200' : 'border-dashed border-ink-300'}`}>
        <span className="block text-xs text-ink-500">{rotulo}</span>
        <input type="text" inputMode="numeric" autoComplete="off" placeholder="--:--" maxLength={5} value={texto} aria-label={rotulo}
          onChange={e => {
            const t = mascaraHora(e.target.value)
            setTexto(t)
            if (horaValida(t)) onChange(t)
            else if (!t) onChange('')
          }}
          className="block w-full bg-transparent p-0 border-0 outline-none text-[1.75rem] leading-tight font-semibold tnum text-ink-900 placeholder:text-ink-300" />
        {invalido && <span className="block text-[11px] text-red-600">Hora inválida</span>}
      </label>
    )
  }
  return (
    <label className={`relative flex-1 min-w-0 overflow-hidden block rounded-xl border bg-white px-4 py-3 cursor-pointer transition-colors ${valor ? 'border-ink-200' : 'border-dashed border-ink-300'}`}>
      <span className="block text-xs text-ink-500">{rotulo}</span>
      <span className={`block text-[1.75rem] leading-tight font-semibold tnum ${valor ? 'text-ink-900' : 'text-ink-300'}`}>{valor || '--:--'}</span>
      <input type="time" value={valor} onChange={e => onChange(e.target.value)} aria-label={rotulo}
        onFocus={() => { if (!valor) onChange(horaAgora()) }}
        className="absolute inset-0 w-full h-full min-w-0 appearance-none opacity-0 cursor-pointer text-[16px]" />
    </label>
  )
}
