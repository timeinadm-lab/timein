import { jornadaDoVinculo, desvioDoDia, textoDoDesvio, horaMin } from '../../lib/jornada'
import type { VinculoJornada } from '../../lib/jornada'

/**
 * Linha abaixo de Entrada/Saída no registro do portal: compara com a jornada
 * do vínculo (horas por dia e, se houver, o horário definido).
 */
export default function JornadaAviso({ vinculo, entrada, saida }: { vinculo?: VinculoJornada | null; entrada: string; saida: string }) {
  const j = jornadaDoVinculo(vinculo)
  if (!j || !entrada || !saida) return null
  const d = desvioDoDia({ check_in: entrada, check_out: saida }, j)
  const combinado = j.entrada && j.saida ? `${j.entrada}–${j.saida}` : `${horaMin(j.minutos)} por dia`
  if (!d) return <p className="text-xs font-medium text-green-700">Dentro da jornada ({combinado})</p>
  return (
    <p className="text-xs font-medium text-amber-700">
      Jornada {combinado} · {textoDoDesvio(d, j)}. O RH é avisado.
    </p>
  )
}
