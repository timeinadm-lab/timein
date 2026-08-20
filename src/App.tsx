import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './contexts/AuthContext'
import { RequireAuth, RequireChefe, RequireContabilidade } from './components/layout/RequireAuth'
import Layout from './components/layout/Layout'

import Login from './pages/Login'
const Dashboard = lazy(() => import('./pages/Dashboard'))

const ClientList = lazy(() => import('./pages/clients/ClientList'))
const ClientForm = lazy(() => import('./pages/clients/ClientForm'))
const ClientDetail = lazy(() => import('./pages/clients/ClientDetail'))

const ContractList = lazy(() => import('./pages/contracts/ContractList'))
const ContractForm = lazy(() => import('./pages/contracts/ContractForm'))
const ContractDetail = lazy(() => import('./pages/contracts/ContractDetail'))

const EmployeeList = lazy(() => import('./pages/employees/EmployeeList'))
const EmployeeForm = lazy(() => import('./pages/employees/EmployeeForm'))
const EmployeeDetail = lazy(() => import('./pages/employees/EmployeeDetail'))

const VacancyList = lazy(() => import('./pages/vacancies/VacancyList'))
const VacancyForm = lazy(() => import('./pages/vacancies/VacancyForm'))
const VacancyDetail = lazy(() => import('./pages/vacancies/VacancyDetail'))

const CandidateList = lazy(() => import('./pages/candidates/CandidateList'))
const CandidateForm = lazy(() => import('./pages/candidates/CandidateForm'))
const CandidateDetail = lazy(() => import('./pages/candidates/CandidateDetail'))
const CandidateKanban = lazy(() => import('./pages/candidates/CandidateKanban'))

const InterviewAgenda = lazy(() => import('./pages/interviews/InterviewAgenda'))
const InterviewForm = lazy(() => import('./pages/interviews/InterviewForm'))

const PaymentList = lazy(() => import('./pages/payments/PaymentList'))
const PaymentForm = lazy(() => import('./pages/payments/PaymentForm'))

const SupervisionDashboard = lazy(() => import('./pages/supervision/SupervisionDashboard'))

const TemplateList = lazy(() => import('./pages/templates/TemplateList'))
const TemplateEditor = lazy(() => import('./pages/templates/TemplateEditor'))

const Chat = lazy(() => import('./pages/chat/Chat'))
const ActivitiesPage = lazy(() => import('./pages/activities/ActivitiesPage'))
const FinanceiroPage = lazy(() => import('./pages/financeiro/FinanceiroPage'))
const CalendarPage = lazy(() => import('./pages/calendar/CalendarPage'))
const UserManagement = lazy(() => import('./pages/admin/UserManagement'))
const ProfilePage = lazy(() => import('./pages/admin/ProfilePage'))
const InspectionPublic = lazy(() => import('./pages/inspections/InspectionPublic'))
import PortalLogin from './pages/portal/PortalLogin'
const PortalHome = lazy(() => import('./pages/portal/PortalHome'))
const VisitsDashboard = lazy(() => import('./pages/visits/VisitsDashboard'))

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 0, staleTime: 30_000 } },
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

              {/* Vacancies */}
              <Route path="vagas" element={<VacancyList />} />
              <Route path="vagas/nova" element={<VacancyForm />} />
              <Route path="vagas/:id" element={<VacancyDetail />} />
              <Route path="vagas/:id/editar" element={<VacancyForm />} />

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
              <Route path="pagamentos/novo" element={<RequireChefe><PaymentForm /></RequireChefe>} />
              <Route path="pagamentos/:id/editar" element={<RequireChefe><PaymentForm /></RequireChefe>} />

              {/* Supervision (recrutador também acessa) */}
              <Route path="supervisao" element={<SupervisionDashboard />} />

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
      </AuthProvider>
    </QueryClientProvider>
  )
}
