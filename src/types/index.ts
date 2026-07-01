export type Role = 'chefe' | 'recrutador'

export interface UserProfile {
  id: string
  full_name: string
  email: string
  role: Role
  created_at: string
  updated_at: string
}

export interface Client {
  id: string
  name: string
  cnpj?: string
  address?: string
  contact_name?: string
  contact_phone?: string
  contact_email?: string
  contract_start?: string
  contract_end?: string
  contract_duration_months?: number
  positions_count?: number
  supervisor_id?: string
  requires_supervision?: boolean
  supervision_visits_per_month?: number
  contract_pdf_url?: string
  employee_contract_pdf_url?: string
  observations?: string
  created_at: string
  updated_at: string
  supervisor?: UserProfile
}

export interface ClientLocation {
  id: string
  client_id: string
  name: string
  hourly_rate?: number
  created_at: string
}

export interface Employee {
  id: string
  full_name: string
  cpf?: string
  birth_date?: string
  address?: string
  whatsapp?: string
  email?: string
  photo_url?: string
  crn_number?: string
  crn_region?: string
  role?: string
  admission_date?: string
  status: 'Ativo' | 'Inativo' | 'Ocioso'
  dismissal_date?: string
  dismissal_reason?: string
  benefits_paid?: boolean
  docs_returned?: boolean
  bank_name?: string
  bank_agency?: string
  bank_account?: string
  bank_account_type?: 'Corrente' | 'Poupança'
  pix?: string
  created_at: string
  updated_at: string
}

export interface EmployeeDocument {
  id: string
  employee_id: string
  name: string
  status: 'Entregue' | 'Pendente' | 'Não se aplica'
  created_at: string
}

export interface EmployeeClientLink {
  id: string
  employee_id: string
  client_id: string
  service_type: 'Fixo' | 'Consultoria' | 'PJ'
  monthly_amount?: number
  weekly_hours_quota?: number
  start_date?: string
  created_at: string
  client?: Client
  payment_dates?: EmployeePaymentDate[]
}

export interface EmployeePaymentDate {
  id: string
  link_id: string
  day_of_month: number
  amount?: number
  created_at: string
}

export interface EmployeePaymentCheck {
  id: string
  payment_date_id: string
  reference_month: string
  paid: boolean
  created_at: string
  payment_date?: EmployeePaymentDate
}

export interface EmployeeHistory {
  id: string
  employee_id: string
  type: 'Mudança de cargo' | 'Aumento' | 'Advertência' | 'Anotação'
  description: string
  responsible?: string
  created_at: string
}

export interface Contract {
  id: string
  client_name?: string
  type: 'Manual' | 'Padrão'
  start_date?: string
  end_date?: string
  signed?: boolean
  signed_at?: string
  employee_responsible?: string
  requires_supervision?: boolean
  supervision_visits_per_month?: number
  supervisor_id?: string
  template_id?: string
  observations?: string
  created_at: string
  updated_at: string
  supervisor?: UserProfile
}

export interface SupervisionVisit {
  id: string
  contract_id?: string
  client_id?: string
  supervisor_id?: string
  supervisor_name?: string
  visit_date: string
  observations?: string
  created_at: string
  supervisor?: UserProfile
}

export interface Vacancy {
  id: string
  title: string
  state: string
  city: string
  sp_region?: string
  client_id?: string
  positions_count?: number
  deadline?: string
  opening_date?: string
  requires_crn?: boolean
  formation?: string
  requires_vehicle?: boolean
  requires_travel?: boolean
  requires_relocation?: boolean
  postgrad_options?: string[]
  tools?: string[]
  observations?: string
  whatsapp_message?: string
  status: 'Aberta' | 'Atuando' | 'Preenchida' | 'Fechada' | 'Pausada'
  hired_count?: number
  created_at: string
  updated_at: string
  client?: Client
}

export interface Candidate {
  id: string
  full_name: string
  state?: string
  city?: string
  sp_region?: string
  whatsapp?: string
  email?: string
  crn_number?: string
  crn_region?: string
  requires_travel?: boolean
  requires_relocation?: boolean
  has_vehicle?: boolean
  formation?: 'Técnico em Nutrição' | 'Nutricionista' | 'Ambos'
  graduation_year?: number
  institution?: string
  postgrad_options?: string[]
  experience_area?: string
  experience_time?: string
  segments?: string[]
  uan_areas?: string[]
  max_meals_volume?: number
  tools?: string[]
  available_start?: string
  available_weekends?: boolean
  work_shift?: string
  work_hours?: string
  contract_types?: string[]
  pipeline_stage: string
  interview_scheduled_at?: string
  rejection_reason?: string
  inactivation_reason?: string
  created_at: string
  updated_at: string
}

export interface CandidateContact {
  id: string
  candidate_id: string
  contact_date: string
  responsible?: string
  observations?: string
  created_at: string
}

export interface VacancyInterest {
  id: string
  vacancy_id: string
  candidate_id: string
  status: 'Interessado' | 'Em contrato' | 'Contratado'
  deadline?: string
  hired_at?: string
  created_at: string
  candidate?: Candidate
  vacancy?: Vacancy
}

export interface ContractTemplate {
  id: string
  name: string
  content: string
  created_at: string
  updated_at: string
}

export interface Payment {
  id: string
  description: string
  amount: number
  due_date: string
  status: 'Pendente' | 'Pago' | 'Cancelado'
  recurrence: 'Único' | 'Mensal'
  category: 'Salário' | 'Fornecedor' | 'Imposto' | 'Outro'
  created_at: string
  updated_at: string
}

export interface InspectionLink {
  id: string
  employee_id: string
  client_id: string
  token: string
  password: string
  expires_at?: string
  is_active: boolean
  created_at: string
  employee?: Employee
  client?: Client
}

export interface Inspection {
  id: string
  link_id: string
  location_id?: string
  check_in: string
  check_out: string
  hours_worked?: number
  amount?: number
  notes?: string
  created_at: string
}

export interface ChatMessage {
  id: string
  user_id: string
  content: string
  created_at: string
  user?: UserProfile
}

export interface Interview {
  id: string
  title?: string
  candidate_id?: string
  recruiter_id?: string
  vacancy_id?: string
  scheduled_at: string
  duration_min?: number
  modality: 'Online' | 'Presencial' | 'Telefone'
  link_or_address?: string
  status: 'Agendada' | 'Realizada' | 'Cancelada' | 'Falta'
  notes?: string
  created_at: string
  updated_at: string
  candidate?: Candidate
  recruiter?: UserProfile
  vacancy?: Vacancy
}
