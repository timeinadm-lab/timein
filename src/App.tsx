import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { ConfirmHost } from './components/ui/ConfirmDialog'
import { AuthProvider } from './contexts/AuthContext'
import { RequireAuth, RequireChefe, RequireContabilidade } from './components/layout/RequireAuth'
import Layout from './components/layout/Layout'
import { carregarTela } from './lib/versaoNova'

import Login from './pages/Login'
const Dashboard = lazy(() => carregarTela(() => import('./pages/Dashboard')))

const ClientList = lazy(() => carregarTela(() => import('./pages/clients/ClientList')))
const ClientForm = lazy(() => carregarTela(() => import('./pages/clients/ClientForm')))
const ClientDetail = lazy(() => carregarTela(() => import('./pages/clients/ClientDetail')))

const ContractList = lazy(() => carregarTela(() => import('./pages/contracts/ContractList')))
const ContractForm = lazy(() => carregarTela(() => import('./pages/contracts/ContractForm')))
const ContractDetail = lazy(() => carregarTela(() => import('./pages/contracts/ContractDetail')))

const EmployeeList = lazy(() => carregarTela(() => import('./pages/employees/EmployeeList')))
const EmployeeForm = lazy(() => carregarTela(() => import('./pages/employees/EmployeeForm')))
const EmployeeDetail = lazy(() => carregarTela(() => import('./pages/employees/EmployeeDetail')))

const CandidateList = lazy(() => carregarTela(() => import('./pages/candidates/CandidateList')))
const CandidateForm = lazy(() => carregarTela(() => import('./pages/candidates/CandidateForm')))
const CandidateDetail = lazy(() => carregarTela(() => import('./pages/candidates/CandidateDetail')))
const CandidateKanban = lazy(() => carregarTela(() => import('./pages/candidates/CandidateKanban')))

const InterviewAgenda = lazy(() => carregarTela(() => import('./pages/interviews/InterviewAgenda')))
const InterviewForm = lazy(() => carregarTela(() => import('./pages/interviews/InterviewForm')))

const PaymentList = lazy(() => carregarTela(() => import('./pages/payments/PaymentList')))
const PaymentForm = lazy(() => carregarTela(() => import('./pages/payments/PaymentForm')))

const SupervisionDashboard = lazy(() => carregarTela(() => import('./pages/supervision/SupervisionDashboard')))
const EquipePage = lazy(() => carregarTela(() => import('./pages/equipe/EquipePage')))
const AuditoriasPage = lazy(() => carregarTela(() => import('./pages/auditorias/AuditoriasPage')))
const AuditoriaDetalhe = lazy(() => carregarTela(() => import('./pages/auditorias/AuditoriaDetalhe')))
const ChecklistsAuditoria = lazy(() => carregarTela(() => import('./pages/auditorias/ChecklistsAuditoria')))
const FornecedoresGRSA = lazy(() => carregarTela(() => import('./pages/auditorias/FornecedoresGRSA')))

const TemplateList = lazy(() => carregarTela(() => import('./pages/templates/TemplateList')))
const TemplateEditor = lazy(() => carregarTela(() => import('./pages/templates/TemplateEditor')))

const Chat = lazy(() => carregarTela(() => import('./pages/chat/Chat')))
const ActivitiesPage = lazy(() => carregarTela(() => import('./pages/activities/ActivitiesPage')))
const FinanceiroPage = lazy(() => carregarTela(() => import('./pages/financeiro/FinanceiroPage')))
const CalendarPage = lazy(() => carregarTela(() => import('./pages/calendar/CalendarPage')))
const AniversariantesPage = lazy(() => carregarTela(() => import('./pages/calendar/AniversariantesPage')))
const PlanilhasPage = lazy(() => carregarTela(() => import('./pages/planilhas/PlanilhasPage')))
const UserManagement = lazy(() => carregarTela(() => import('./pages/admin/UserManagement')))
const ProfilePage = lazy(() => carregarTela(() => import('./pages/admin/ProfilePage')))
const InspectionPublic = lazy(() => carregarTela(() => import('./pages/inspections/InspectionPublic')))
import PortalLogin from './pages/portal/PortalLogin'
const PortalHome = lazy(() => carregarTela(() => import('./pages/portal/PortalHome')))
const VisitsDashboard = lazy(() => carregarTela(() => import('./pages/visits/VisitsDashboard')))
const JornadaPage = lazy(() => carregarTela(() => import('./pages/visits/JornadaPage')))

const queryClient = new QueryClient({
  // 18/11/2026: antes era retry 0 — qualquer oscilação da internet deixava a tela
  // com erro até recarregar ("parece que cai"). Agora tenta mais 2 vezes sozinho.
  // Só leitura: gravação (mutation) nunca repete, para não salvar duas vezes.
  defaultOptions: { queries: { retry: 2, retryDelay: n => Math.min(800 * 2 ** n, 4000), staleTime: 30_000 } },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          {/* Cada rota vira um pedaço separado, baixado só quando aberta. Antes
              tudo vinha num pacote único de ~2 MB: a tela de login do portal
              baixava o sistema administrativo inteiro só pra mostrar dois campos. */}
          <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
              <div className="w-8 h-8 rounded-full border-2 border-primary-200 border-t-primary-600 animate-spin" />
            </div>
          }>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/portal" element={<PortalLogin />} />
            <Route path="/portal/home" element={<PortalHome />} />
            <Route path="/vistoria/:token" element={<InspectionPublic />} />

            <Route path="/" element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }>
              <Route index element={<Dashboard />} />

              {/* Clients */}
              <Route path="clientes" element={<ClientList />} />
              <Route path="clientes/novo" element={<ClientForm />} />
              <Route path="clientes/:id" element={<ClientDetail />} />
              <Route path="clientes/:id/editar" element={<ClientForm />} />

              {/* Contracts */}
              <Route path="contratos" element={<ContractList />} />
              <Route path="contratos/novo" element={<ContractForm />} />
              <Route path="contratos/:id" element={<ContractDetail />} />
              <Route path="contratos/:id/editar" element={<ContractForm />} />

              {/* Employees */}
              <Route path="colaboradores" element={<EmployeeList />} />
              <Route path="colaboradores/novo" element={<EmployeeForm />} />
              <Route path="colaboradores/:id" element={<EmployeeDetail />} />
              <Route path="colaboradores/:id/editar" element={<EmployeeForm />} />

              {/* 19/11/2026: a aba Vagas saiu (pedido do Gabriel: "a gente não tá usando"). Link antigo cai nos candidatos. */}
              <Route path="vagas/*" element={<Navigate to="/candidatos" replace />} />

              {/* Candidates */}
              <Route path="candidatos" element={<CandidateList />} />
              <Route path="candidatos/kanban" element={<CandidateKanban />} />
              <Route path="candidatos/novo" element={<CandidateForm />} />
              <Route path="candidatos/:id" element={<CandidateDetail />} />
              <Route path="candidatos/:id/editar" element={<CandidateForm />} />

              {/* Interviews */}
              <Route path="agenda" element={<InterviewAgenda />} />
              <Route path="agenda/nova" element={<InterviewForm />} />
              <Route path="agenda/:id/editar" element={<InterviewForm />} />

              {/* Payments (chefe only) */}
              <Route path="pagamentos" element={<RequireChefe><PaymentList /></RequireChefe>} />
              <Route path="planilhas" element={<RequireChefe><PlanilhasPage /></RequireChefe>} />
              <Route path="pagamentos/novo" element={<RequireChefe><PaymentForm /></RequireChefe>} />
              <Route path="pagamentos/:id/editar" element={<RequireChefe><PaymentForm /></RequireChefe>} />

              {/* Supervision (recrutador também acessa) */}
              <Route path="supervisao" element={<SupervisionDashboard />} />
              <Route path="equipe" element={<EquipePage />} />
              <Route path="auditorias" element={<AuditoriasPage />} />
              <Route path="auditorias/checklists" element={<ChecklistsAuditoria />} />
              <Route path="auditorias/fornecedores" element={<FornecedoresGRSA />} />
              <Route path="auditorias/:id" element={<AuditoriaDetalhe />} />
              <Route path="jornada" element={<JornadaPage />} />

              {/* Templates */}
              <Route path="templates" element={<TemplateList />} />
              <Route path="templates/novo" element={<TemplateEditor />} />
              <Route path="templates/:id/editar" element={<TemplateEditor />} />

              {/* Visits dashboard */}
              <Route path="visitas" element={<VisitsDashboard />} />

              {/* Chat */}
              <Route path="chat" element={<Chat />} />

              {/* Calendário vivo da empresa */}
              <Route path="calendario" element={<CalendarPage />} />
              <Route path="aniversariantes" element={<AniversariantesPage />} />

              {/* Atividades do administrativo */}
              <Route path="atividades" element={<ActivitiesPage />} />

              {/* Financeiro — só contabilidade */}
              <Route path="financeiro" element={<RequireContabilidade><FinanceiroPage /></RequireContabilidade>} />

              {/* Admin (chefe only) — protege o PIN de exclusão e a gestão de contas */}
              <Route path="usuarios" element={<RequireChefe><UserManagement /></RequireChefe>} />

              {/* Profile */}
              <Route path="perfil" element={<ProfilePage />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster position="top-right" />
        <ConfirmHost />
      </AuthProvider>
    </QueryClientProvider>
  )
}
