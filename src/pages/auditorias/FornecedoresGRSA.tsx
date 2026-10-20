import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import AuditoriaGR from '../planilhas/AuditoriaGR'

/**
 * Auditoria GR pela aba Auditorias (087 → 100). A tela é a mesma de
 * Planilhas → Auditoria GR (pedido de 20/10/2026); aqui fica para quem
 * não é da chefia também conseguir abrir.
 */
export default function FornecedoresGRSA() {
  const navigate = useNavigate()
  return (
    <div className="space-y-5">
      <div>
        <button onClick={() => navigate('/auditorias')} className="eyebrow mb-1 inline-flex items-center gap-1 hover:text-ink-700"><ArrowLeft size={13} />Auditorias</button>
        <h1 className="page-title">Auditoria GR</h1>
        <p className="text-sm text-ink-500 mt-1">Fornecedores da GRSA: do orçamento à validade da próxima auditoria, com o financeiro. Uso interno.</p>
      </div>
      <AuditoriaGR />
    </div>
  )
}
