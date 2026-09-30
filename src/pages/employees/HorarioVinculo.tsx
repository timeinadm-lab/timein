import { useState } from 'react'

/**
 * Horário do vínculo: livre (só cumprir as horas por dia) ou definido
 * (entrada e saída, ex.: 08:00 às 20:00). Com horário definido o sistema
 * avisa também atraso e saída antes da hora (migração 067).
 */
export default function HorarioVinculo({ inicio, fim, onChange, intervalo, onIntervalo, compacto }: {
  inicio: string; fim: string
  onChange: (inicio: string, fim: string) => void
  intervalo: string
  onIntervalo: (minutos: string) => void
  compacto?: boolean
}) {
  const [definido, setDefinido] = useState(!!(inicio || fim))
  const lbl = compacto ? 'label text-xs' : 'label'
  const inp = compacto ? 'input text-sm' : 'input'
  return (
    <div className="col-span-full space-y-2">
      <label className={lbl}>Horário</label>
      <div className="grid grid-cols-2 gap-2">
        {([[false, 'Livre', 'só cumprir as horas'], [true, 'Definido', 'entrada e saída']] as const).map(([v, t, d]) => (
          <button key={t} type="button"
            onClick={() => { setDefinido(v); if (!v) onChange('', '') }}
            className={`text-left px-3 py-2 rounded-lg border-2 transition-colors ${definido === v ? 'border-primary-600 bg-primary-50' : 'border-ink-200 hover:border-ink-300'}`}>
            <p className="text-sm font-medium text-ink-900">{t}</p>
            <p className="text-[11px] text-ink-500">{d}</p>
          </button>
        ))}
      </div>
      {definido && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={lbl}>Entrada</label>
            <input className={inp} type="time" value={inicio} onChange={e => onChange(e.target.value, fim)} />
          </div>
          <div>
            <label className={lbl}>Saída</label>
            <input className={inp} type="time" value={fim} onChange={e => onChange(inicio, e.target.value)} />
          </div>
        </div>
      )}
      <div>
        <label className={lbl}>Intervalo (almoço)</label>
        <select className={inp} value={intervalo} onChange={e => onIntervalo(e.target.value)}>
          <option value="">Sem intervalo</option>
          <option value="15">15 min</option>
          <option value="30">30 min</option>
          <option value="60">1h</option>
          <option value="90">1h30</option>
          <option value="120">2h</option>
        </select>
        <p className="text-[11px] text-ink-400 mt-1">Descontado das horas do dia. Ex.: 08:00 às 17:00 com 1h de intervalo = 8h.</p>
      </div>
    </div>
  )
}
