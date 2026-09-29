import { format, parseISO, differenceInDays, isValid } from 'date-fns'
import { ptBR } from 'date-fns/locale'

/**
 * A data de HOJE no horário de quem está usando (Brasil), no formato AAAA-MM-DD.
 * Não use `new Date().toISOString().slice(0, 10)`: isso é o horário de Londres,
 * e depois das 21h no Brasil já devolve o dia de AMANHÃ — plantão noturno
 * registrado às 22h ia parar no dia seguinte.
 */
export function hojeISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function formatDate(date: string | Date | null | undefined, pattern = 'dd/MM/yyyy'): string {
  if (!date) return '-'
  try {
    const d = typeof date === 'string' ? parseISO(date) : date
    if (!isValid(d)) return '-'
    return format(d, pattern, { locale: ptBR })
  } catch {
    return '-'
  }
}

export function formatDateTime(date: string | Date | null | undefined): string {
  return formatDate(date, 'dd/MM/yyyy HH:mm')
}

// Agenda/compromissos são gravados como "hora de parede" (naive). Estes helpers
// tratam a data como LOCAL — ignoram o fuso do banco — pra mostrar exatamente a
// hora digitada (ex: cadastrou 19h → mostra 19h, sem virar 16h).
export function parseLocal(date?: string | null): Date | null {
  if (!date) return null
  const clean = date.replace(/(Z|[+-]\d{2}:?\d{2})$/, '')  // remove o fuso do fim
  const d = parseISO(clean)
  return isValid(d) ? d : null
}
/**
 * Compromisso com período ("Até", ex.: reunião diária até 16/10, férias): vale
 * em todos os dias do início ao fim. Sem "Até", só no dia do início.
 */
export function compromissoNoDia(scheduledAt: string | null | undefined, endDate: string | null | undefined, dia: string): boolean {
  const ini = parseLocal(scheduledAt)
  if (!ini) return false
  const diaIni = format(ini, 'yyyy-MM-dd')
  const diaFim = endDate && endDate.slice(0, 10) > diaIni ? endDate.slice(0, 10) : diaIni
  return dia >= diaIni && dia <= diaFim
}

export function formatLocalDateTime(date?: string | null): string {
  const d = parseLocal(date)
  return d ? format(d, 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '-'
}
export function formatLocalTime(date?: string | null): string {
  const d = parseLocal(date)
  return d ? format(d, 'HH:mm', { locale: ptBR }) : '-'
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return 'R$ 0,00'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

export function daysUntil(date: string | Date | null | undefined): number | null {
  if (!date) return null
  try {
    const d = typeof date === 'string' ? parseISO(date) : date
    return differenceInDays(d, new Date())
  } catch {
    return null
  }
}

export function formatWhatsApp(phone: string | null | undefined): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('55')) return `https://wa.me/${digits}`
  return `https://wa.me/55${digits}`
}

// Aceita null/undefined: dados do banco podem vir vazios e não devem quebrar a tela
export function getInitials(name?: string | null): string {
  if (!name) return '?'
  return String(name)
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => (w[0] || '').toUpperCase())
    .join('') || '?'
}

export const DEFAULT_DOCUMENTS = [
  'RG',
  'CPF',
  'Comprovante de Residência',
  'Carteira de Trabalho',
  'Foto 3x4',
  'Contrato Assinado',
  'CRN',
  'Diploma',
  'Certidão de Nascimento/Casamento',
]

export const BRAZIL_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]

export const SP_REGIONS = [
  'Capital', 'ABC', 'Baixada Santista', 'Campinas', 'Vale do Paraíba',
  'Sorocaba', 'Piracicaba', 'Ribeirão Preto', 'São José do Rio Preto',
  'Presidente Prudente', 'Araçatuba', 'Bauru', 'Marília', 'Araraquara',
  'Franca', 'Outra',
]

// Alinhados com o formulário Google Forms de recrutamento
export const TOOLS_OPTIONS = [
  'TecFood', 'Checklists Digitais (Foodchecker / Checklist Fácil)',
  'Genial', 'Excel', 'Elaboração de Relatórios Técnicos',
  'Tasy', 'Apresentações (PowerPoint / Canva)',
]

export const POSTGRAD_OPTIONS = [
  'Nutrição Clínica', 'Nutrição Esportiva', 'Nutrição Materno-Infantil',
  'Gestão de Unidades de Alimentação', 'Gastronomia', 'Saúde Coletiva',
  'Gestão Hospitalar', 'Docência', 'Outra',
]

// Segmentos exatos do formulário
export const SEGMENT_OPTIONS = [
  'Restaurantes comerciais', 'Cozinhas industriais', 'Hospitais',
  'Escolas/Universidades', 'Eventos', 'Indústria de alimentos', 'Lactário',
]

// Áreas de experiência / interesse (campo "maior tempo de experiência")
export const AREA_INTEREST_OPTIONS = [
  'UAN', 'Nutrição Clínica', 'Nutrição Esportiva', 'Saúde Pública',
]

export const UAN_OPTIONS = [
  'Planejamento', 'Controle de Qualidade', 'Produção', 'Auditoria / Fiscalização',
]

// Volume de refeições
export const MEALS_VOLUME_OPTIONS = [
  'Busco minha primeira oportunidade', '100 a 200', '200 a 500',
  '500 a 1.000', '1.000 a 5.000', 'Acima de 5.000',
]

// Tempo de experiência (valor exato do forms)
export const EXPERIENCE_TIME_OPTIONS = [
  'Nenhuma. Busco minha primeira oportunidade.',
  'Até 1 ano', '1 a 3 anos', '3 a 5 anos', 'Mais de 5 anos',
]

// Mínimo de experiência exigido na vaga
export const MIN_EXPERIENCE_OPTIONS = [
  'Qualquer', 'Mais de 1 ano', 'Mais de 3 anos', 'Mais de 5 anos',
]

export const SHIFT_OPTIONS = ['Diurno', 'Noturno', 'Ambos']

export const WORK_SCALE_OPTIONS = [
  '5x2', '6x1', '12x36', 'Disponibilidade para qualquer escala',
]

export const START_AVAILABILITY_OPTIONS = [
  'Imediato', 'Até 15 dias', '30 dias ou mais',
]

export const CONTRACT_TYPE_OPTIONS = [
  'CLT', 'PJ', 'Consultoria', 'Freelancer', 'Atuação por qualquer tipo de vínculo',
]

export const PIPELINE_STAGES = [
  'Banco',
  'Em Avaliação',
  'Contato Feito',
  'Entrevista Agendada',
  'Aprovado',
  'Em Processo de Contratação',
  'Contratado',
  // Saíram do processo, mas por motivos diferentes — e isso importa na hora de
  // reaproveitar o banco: quem "está trabalhando" pode voltar mais pra frente,
  // quem "não tem interesse" foi decisão da pessoa, e "reprovado" foi nossa.
  'Não tem interesse',
  'Está trabalhando',
  'Reprovado',
  'Inativo',
]

export const PIPELINE_COLORS: Record<string, string> = {
  'Banco': 'bg-gray-100 text-gray-700',
  'Em Avaliação': 'bg-purple-100 text-purple-700',
  'Contato Feito': 'bg-blue-100 text-blue-700',
  'Entrevista Agendada': 'bg-orange-100 text-orange-700',
  'Aprovado': 'bg-green-100 text-green-700',
  'Em Processo de Contratação': 'bg-blue-800 text-white',
  'Contratado': 'bg-green-800 text-white',
  'Não tem interesse': 'bg-amber-100 text-amber-700',
  'Está trabalhando': 'bg-cyan-100 text-cyan-700',
  'Reprovado': 'bg-red-100 text-red-700',
  'Inativo': 'bg-gray-700 text-white',
}

/**
 * Nome do tipo de vínculo como o usuário conhece.
 * O banco guarda 'Volante', mas em toda a interface isso se chama "Freela".
 * Use sempre esta função ao exibir service_type — nunca o valor cru.
 */
export function serviceTypeLabel(serviceType?: string | null): string {
  if (!serviceType) return '—'
  // Freela deixou de existir (migração 058): o que ainda vier como 'Volante'
  // é mostrado como Fixo — é o que ele vira na conversão
  return serviceType === 'Volante' ? 'Fixo' : serviceType
}

// ── Tipos de vínculo (depois do fim do Freela) ──────────────────────────────
// Sobram dois tipos: Fixo e Consultoria. O Fixo pode ser pago por mês
// (salário) ou por diária (dias trabalhados × diária). Qualquer vínculo pode
// ser temporário (nasceu para acabar: cobertura, auditoria avulsa).
// Estas funções aceitam também o formato antigo ('Volante' + coverage_type),
// então funcionam antes e depois da migração 058.
type VinculoTipo = { service_type?: string | null; coverage_type?: string | null; pay_mode?: string | null; is_temporary?: boolean | null }

/** 'Consultoria' ou 'Fixo' — o tipo que vale para pagamento e portal */
export function tipoDoVinculo(l?: VinculoTipo | null): 'Consultoria' | 'Fixo' {
  if (!l) return 'Fixo'
  if (l.service_type === 'Volante') return l.coverage_type === 'Consultoria' ? 'Consultoria' : 'Fixo'
  return l.service_type === 'Consultoria' ? 'Consultoria' : 'Fixo'
}

/** Fixo pago pelos dias trabalhados × diária (antigo freela de cobertura) */
export function pagaPorDiaria(l?: VinculoTipo | null): boolean {
  if (!l) return false
  if (l.service_type === 'Volante') return l.coverage_type !== 'Consultoria'
  return tipoDoVinculo(l) === 'Fixo' && l.pay_mode === 'diaria'
}

/** Consultoria paga por SALÁRIO FIXO mensal (não por visita) — migração 060 */
export function salarioConsultoria(l?: VinculoTipo | null): boolean {
  return !!l && tipoDoVinculo(l) === 'Consultoria' && l.pay_mode === 'salario_fixo'
}

/**
 * Recebe MENSAL por contrato (não por visita nem por diária): Fixo mensal e
 * Consultoria com salário fixo. Só esse grupo tem Folga e Falta no portal —
 * para quem recebe por visita/diária, dia sem trabalho simplesmente não é pago.
 * (Decisão do Gabriel, 29/09/2026.)
 */
export function recebeMensal(l?: VinculoTipo | null): boolean {
  if (!l) return false
  return salarioConsultoria(l) || (tipoDoVinculo(l) === 'Fixo' && !pagaPorDiaria(l))
}

/** Vínculo que nasceu para acabar (cobertura, auditoria avulsa) */
export function ehTemporario(l?: VinculoTipo | null): boolean {
  return !!l && (l.service_type === 'Volante' || !!l.is_temporary)
}

/**
 * Vínculo que deve ter contrato anexado. Desde a migração 042 (19/08/2026) o RH
 * marca "exige contrato" ao vincular; vínculo marcado "não" não é pendência.
 * Os mais antigos não tinham essa opção, então continuam contando.
 */
export const INICIO_CONTRATO_EXIGIDO = '2026-08-19'
export function precisaContrato(l?: { contract_required?: boolean | null; created_at?: string | null } | null): boolean {
  if (!l) return false
  if (l.contract_required) return true
  return !!l.created_at && l.created_at.slice(0, 10) < INICIO_CONTRATO_EXIGIDO
}

/** Rótulo curto do vínculo para as telas */
export function rotuloDoVinculo(l?: VinculoTipo | null): string {
  const t = tipoDoVinculo(l)
  if (salarioConsultoria(l)) return 'Consultoria · salário fixo'
  return t === 'Fixo' && pagaPorDiaria(l) ? 'Fixo · por diária' : t
}

/** O campo link_or_address guarda ora um link de reunião, ora um endereço. */
export function isMeetingLink(value?: string | null): boolean {
  return !!value && /^https?:\/\//i.test(value.trim())
}

/** Abre o endereço no Google Maps. */
export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`
}

// Sem acento e minúsculo, para busca: "debora" acha "Débora", "joao" acha "João"
export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

// Cor fixa por pessoa para o avatar de iniciais: a mesma pessoa tem sempre a
// mesma cor, em qualquer tela. Tons suaves — ajuda a achar gente numa lista
// sem virar arco-íris.
const CORES_AVATAR = [
  'bg-[#E1F5EE] text-[#085041]', // verde-água
  'bg-[#E6F1FB] text-[#0C447C]', // azul
  'bg-[#FBEAF0] text-[#72243E]', // rosa
  'bg-[#FAEEDA] text-[#633806]', // âmbar
  'bg-[#EEEDFE] text-[#3C3489]', // lilás
  'bg-[#FAECE7] text-[#712B13]', // coral
  'bg-[#EAF3DE] text-[#27500A]', // verde
  'bg-[#F1EFE8] text-[#444441]', // areia
]
export function corDoAvatar(nome?: string | null): string {
  const s = semAcento(nome || '?')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return CORES_AVATAR[h % CORES_AVATAR.length]
}
