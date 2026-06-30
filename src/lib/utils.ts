import { format, parseISO, differenceInDays, isValid } from 'date-fns'
import { ptBR } from 'date-fns/locale'

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

export function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')
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
  'Reprovado': 'bg-red-100 text-red-700',
  'Inativo': 'bg-gray-700 text-white',
}
