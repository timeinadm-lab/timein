import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './contexts/AuthContext'
import { RequireAuth, RequireChefe } from './components/layout/RequireAuth'
import Layout from './components/layout/Layout'

import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

import ClientList from './pages/clients/ClientList'
import ClientForm from './pages/clients/ClientForm'
import ClientDetail from './pages/clients/ClientDetail'

import ContractList from './pages/contracts/ContractList'
import ContractForm from './pages/contracts/ContractForm'
import ContractDetail from './pages/contracts/ContractDetail'

import EmployeeList from './pages/employees/EmployeeList'
import EmployeeForm from './pages/employees/EmployeeForm'
import EmployeeDetail from './pages/employees/EmployeeDetail'

import VacancyList from './pages/vacancies/VacancyList'
import VacancyForm from './pages/vacancies/VacancyForm'
import VacancyDetail from './pages/vacancies/VacancyDetail'

import CandidateList from './pages/candidates/CandidateList'
import CandidateForm from './pages/candidates/CandidateForm'
import CandidateDetail from './pages/candidates/CandidateDetail'
import CandidateKanban from './pages/candidates/CandidateKanban'

import InterviewAgenda from './pages/interviews/InterviewAgenda'
import InterviewForm from './pages/interviews/InterviewForm'

import PaymentList from './pages/payments/PaymentList'
import PaymentForm from './pages/payments/PaymentForm'

import SupervisionDashboard from './pages/supervision/SupervisionDashboard'

import TemplateList from './pages/templates/TemplateList'
import TemplateEditor from './pages/templates/TemplateEditor'

import Chat from './pages/chat/Chat'
import UserManagement from './pages/admin/UserManagement'
import ProfilePage from './pages/admin/ProfilePage'
import InspectionPublic from './pages/inspections/InspectionPublic'
import PortalLogin from './pages/portal/PortalLogin'
import PortalHome from './pages/portal/PortalHome'
import VisitsDashboard from './pages/visits/VisitsDashboard'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 0, staleTime: 30_000 } },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
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

              {/* Admin (chefe only) */}
              <Route path="usuarios" element={<RequireChefe><UserManagement /></RequireChefe>} />

              {/* Profile */}
              <Route path="perfil" element={<ProfilePage />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  )
}
