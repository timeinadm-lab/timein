-- ============================================================
-- TIME IN — SCHEMA COMPLETO
-- Execute no SQL Editor do Supabase
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USER PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT 'recrutador' CHECK (role IN ('chefe', 'recrutador')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_profiles" ON user_profiles FOR ALL USING (auth.role() = 'authenticated');

-- Trigger: auto insert on user creation
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.email, ''),
    'recrutador'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                            TEXT NOT NULL,
  cnpj                            TEXT,
  address                         TEXT,
  contact_name                    TEXT,
  contact_phone                   TEXT,
  contact_email                   TEXT,
  contract_start                  DATE,
  contract_end                    DATE,
  contract_duration_months        INTEGER,
  positions_count                 INTEGER,
  supervisor_id                   UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  requires_supervision            BOOLEAN DEFAULT FALSE,
  supervision_visits_per_month    INTEGER,
  contract_pdf_url                TEXT,
  employee_contract_pdf_url       TEXT,
  observations                    TEXT,
  created_at                      TIMESTAMPTZ DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_clients" ON clients FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- CLIENT LOCATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS client_locations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  hourly_rate NUMERIC(10,2),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE client_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_locations" ON client_locations FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- EMPLOYEES
-- ============================================================
CREATE TABLE IF NOT EXISTS employees (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name           TEXT NOT NULL,
  cpf                 TEXT,
  birth_date          DATE,
  address             TEXT,
  whatsapp            TEXT,
  email               TEXT,
  photo_url           TEXT,
  crn_number          TEXT,
  crn_region          TEXT,
  role                TEXT,
  admission_date      DATE,
  status              TEXT NOT NULL DEFAULT 'Ativo' CHECK (status IN ('Ativo', 'Desligado')),
  dismissal_date      DATE,
  dismissal_reason    TEXT,
  benefits_paid       BOOLEAN DEFAULT FALSE,
  docs_returned       BOOLEAN DEFAULT FALSE,
  bank_name           TEXT,
  bank_agency         TEXT,
  bank_account        TEXT,
  bank_account_type   TEXT DEFAULT 'Corrente' CHECK (bank_account_type IN ('Corrente', 'Poupança')),
  pix                 TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_employees" ON employees FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- EMPLOYEE DOCUMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_documents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Entregue', 'Pendente', 'Não se aplica')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_emp_docs" ON employee_documents FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- EMPLOYEE CLIENT LINKS
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_client_links (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id         UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_type        TEXT NOT NULL DEFAULT 'PJ' CHECK (service_type IN ('PJ', 'Consultoria')),
  monthly_amount      NUMERIC(10,2),
  weekly_hours_quota  NUMERIC(5,2),
  start_date          DATE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE employee_client_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_emp_links" ON employee_client_links FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- EMPLOYEE PAYMENT DATES
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_payment_dates (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  link_id       UUID NOT NULL REFERENCES employee_client_links(id) ON DELETE CASCADE,
  day_of_month  INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  amount        NUMERIC(10,2),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE employee_payment_dates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_pay_dates" ON employee_payment_dates FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- EMPLOYEE PAYMENT CHECKS
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_payment_checks (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_date_id   UUID NOT NULL REFERENCES employee_payment_dates(id) ON DELETE CASCADE,
  reference_month   TEXT NOT NULL, -- formato: yyyy-MM
  paid              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (payment_date_id, reference_month)
);

ALTER TABLE employee_payment_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_pay_checks" ON employee_payment_checks FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- EMPLOYEE HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS employee_history (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('Mudança de cargo', 'Aumento', 'Advertência', 'Anotação')),
  description TEXT NOT NULL,
  responsible TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE employee_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_emp_history" ON employee_history FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- CONTRACTS
-- ============================================================
CREATE TABLE IF NOT EXISTS contracts (
  id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_name                     TEXT,
  type                            TEXT NOT NULL DEFAULT 'Manual' CHECK (type IN ('Manual', 'Padrão')),
  start_date                      DATE,
  end_date                        DATE,
  signed                          BOOLEAN DEFAULT FALSE,
  signed_at                       DATE,
  employee_responsible            TEXT,
  requires_supervision            BOOLEAN DEFAULT FALSE,
  supervision_visits_per_month    INTEGER,
  supervisor_id                   UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  template_id                     UUID,
  observations                    TEXT,
  created_at                      TIMESTAMPTZ DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_contracts" ON contracts FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- SUPERVISION VISITS
-- ============================================================
CREATE TABLE IF NOT EXISTS supervision_visits (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id     UUID REFERENCES contracts(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
  supervisor_id   UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  supervisor_name TEXT,
  visit_date      DATE NOT NULL,
  observations    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE supervision_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_visits" ON supervision_visits FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- VACANCIES
-- ============================================================
CREATE TABLE IF NOT EXISTS vacancies (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title               TEXT NOT NULL,
  state               TEXT NOT NULL,
  city                TEXT NOT NULL,
  sp_region           TEXT,
  client_id           UUID REFERENCES clients(id) ON DELETE SET NULL,
  positions_count     INTEGER DEFAULT 1,
  deadline            DATE,
  opening_date        DATE,
  requires_crn        BOOLEAN DEFAULT FALSE,
  formation           TEXT,
  requires_vehicle    BOOLEAN DEFAULT FALSE,
  requires_travel     BOOLEAN DEFAULT FALSE,
  requires_relocation BOOLEAN DEFAULT FALSE,
  postgrad_options    TEXT[] DEFAULT '{}',
  tools               TEXT[] DEFAULT '{}',
  observations        TEXT,
  whatsapp_message    TEXT,
  status              TEXT NOT NULL DEFAULT 'Aberta' CHECK (status IN ('Aberta', 'Fechada', 'Pausada')),
  hired_count         INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vacancies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_vacancies" ON vacancies FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- CANDIDATES
-- ============================================================
CREATE TABLE IF NOT EXISTS candidates (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name               TEXT NOT NULL,
  state                   TEXT,
  city                    TEXT,
  sp_region               TEXT,
  whatsapp                TEXT,
  email                   TEXT,
  crn_number              TEXT,
  crn_region              TEXT,
  requires_travel         BOOLEAN DEFAULT FALSE,
  requires_relocation     BOOLEAN DEFAULT FALSE,
  has_vehicle             BOOLEAN DEFAULT FALSE,
  formation               TEXT,
  graduation_year         INTEGER,
  institution             TEXT,
  postgrad_options        TEXT[] DEFAULT '{}',
  experience_area         TEXT,
  experience_time         TEXT,
  segments                TEXT[] DEFAULT '{}',
  uan_areas               TEXT[] DEFAULT '{}',
  max_meals_volume        INTEGER,
  tools                   TEXT[] DEFAULT '{}',
  available_start         DATE,
  available_weekends      BOOLEAN DEFAULT FALSE,
  work_shift              TEXT,
  work_hours              TEXT,
  contract_types          TEXT[] DEFAULT '{}',
  pipeline_stage          TEXT NOT NULL DEFAULT 'Banco',
  interview_scheduled_at  TIMESTAMPTZ,
  rejection_reason        TEXT,
  inactivation_reason     TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_candidates" ON candidates FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- CANDIDATE CONTACTS
-- ============================================================
CREATE TABLE IF NOT EXISTS candidate_contacts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id  UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  contact_date  DATE NOT NULL,
  responsible   TEXT,
  observations  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE candidate_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_contacts" ON candidate_contacts FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- VACANCY INTERESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS vacancy_interests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vacancy_id    UUID NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  candidate_id  UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'Interessado' CHECK (status IN ('Interessado', 'Em contrato', 'Contratado')),
  deadline      TIMESTAMPTZ,
  hired_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (vacancy_id, candidate_id)
);

ALTER TABLE vacancy_interests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_interests" ON vacancy_interests FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- CONTRACT TEMPLATES
-- ============================================================
CREATE TABLE IF NOT EXISTS contract_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_templates" ON contract_templates FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  description TEXT NOT NULL,
  amount      NUMERIC(10,2) NOT NULL,
  due_date    DATE NOT NULL,
  status      TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente', 'Pago', 'Cancelado')),
  recurrence  TEXT NOT NULL DEFAULT 'Único' CHECK (recurrence IN ('Único', 'Mensal')),
  category    TEXT NOT NULL DEFAULT 'Outro' CHECK (category IN ('Salário', 'Fornecedor', 'Imposto', 'Outro')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_payments" ON payments FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- INSPECTION LINKS
-- ============================================================
CREATE TABLE IF NOT EXISTS inspection_links (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token       UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  password    TEXT NOT NULL,
  expires_at  TIMESTAMPTZ,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE inspection_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_links" ON inspection_links FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- INSPECTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS inspections (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  link_id      UUID NOT NULL REFERENCES inspection_links(id) ON DELETE CASCADE,
  location_id  UUID REFERENCES client_locations(id) ON DELETE SET NULL,
  check_in     TIMESTAMPTZ NOT NULL,
  check_out    TIMESTAMPTZ NOT NULL,
  hours_worked NUMERIC(6,2),
  amount       NUMERIC(10,2),
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_inspections" ON inspections FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- CHAT MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_chat" ON chat_messages FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- INTERVIEWS
-- ============================================================
CREATE TABLE IF NOT EXISTS interviews (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id    UUID REFERENCES candidates(id) ON DELETE CASCADE,
  recruiter_id    UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  vacancy_id      UUID REFERENCES vacancies(id) ON DELETE SET NULL,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  duration_min    INTEGER DEFAULT 30,
  modality        TEXT DEFAULT 'Online' CHECK (modality IN ('Online', 'Presencial', 'Telefone')),
  link_or_address TEXT,
  status          TEXT DEFAULT 'Agendada' CHECK (status IN ('Agendada', 'Realizada', 'Cancelada', 'Falta')),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE interviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_interviews" ON interviews FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- PUBLIC RPC FUNCTIONS (SECURITY DEFINER)
-- ============================================================

CREATE OR REPLACE FUNCTION get_inspection_data(p_token UUID, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link inspection_links%ROWTYPE;
  v_emp  employees%ROWTYPE;
  v_cli  clients%ROWTYPE;
  v_locs JSON;
BEGIN
  SELECT * INTO v_link
  FROM inspection_links
  WHERE token = p_token
    AND password = p_password
    AND is_active = TRUE
    AND (expires_at IS NULL OR expires_at > NOW());

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_emp FROM employees WHERE id = v_link.employee_id;
  SELECT * INTO v_cli FROM clients WHERE id = v_link.client_id;

  SELECT json_agg(json_build_object('id', id, 'name', name, 'hourly_rate', hourly_rate))
  INTO v_locs
  FROM client_locations WHERE client_id = v_link.client_id;

  RETURN json_build_object(
    'link_id', v_link.id,
    'employee', json_build_object('id', v_emp.id, 'full_name', v_emp.full_name, 'cpf', v_emp.cpf),
    'client', json_build_object('id', v_cli.id, 'name', v_cli.name),
    'locations', COALESCE(v_locs, '[]'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_inspection_data(UUID, TEXT) TO anon;

CREATE OR REPLACE FUNCTION submit_inspection(
  p_token       UUID,
  p_password    TEXT,
  p_location_id UUID,
  p_check_in    TIMESTAMPTZ,
  p_check_out   TIMESTAMPTZ,
  p_notes       TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link       inspection_links%ROWTYPE;
  v_hourly     NUMERIC(10,2) := 0;
  v_hours      NUMERIC(6,2);
  v_amount     NUMERIC(10,2);
  v_inspection inspections%ROWTYPE;
BEGIN
  SELECT * INTO v_link
  FROM inspection_links
  WHERE token = p_token
    AND password = p_password
    AND is_active = TRUE
    AND (expires_at IS NULL OR expires_at > NOW());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Token ou senha inválidos';
  END IF;

  SELECT hourly_rate INTO v_hourly FROM client_locations WHERE id = p_location_id;

  v_hours  := ROUND(EXTRACT(EPOCH FROM (p_check_out - p_check_in)) / 3600.0, 2);
  v_amount := ROUND(v_hours * COALESCE(v_hourly, 0), 2);

  INSERT INTO inspections (link_id, location_id, check_in, check_out, hours_worked, amount, notes)
  VALUES (v_link.id, p_location_id, p_check_in, p_check_out, v_hours, v_amount, p_notes)
  RETURNING * INTO v_inspection;

  RETURN json_build_object(
    'id', v_inspection.id,
    'hours_worked', v_inspection.hours_worked,
    'amount', v_inspection.amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION submit_inspection(UUID, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO anon;

CREATE OR REPLACE FUNCTION get_my_inspections(p_token UUID, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link inspection_links%ROWTYPE;
  v_result JSON;
BEGIN
  SELECT * INTO v_link
  FROM inspection_links
  WHERE token = p_token
    AND password = p_password
    AND is_active = TRUE;

  IF NOT FOUND THEN
    RETURN '[]'::json;
  END IF;

  SELECT json_agg(r ORDER BY r.check_in DESC)
  INTO v_result
  FROM (
    SELECT
      i.id,
      i.check_in,
      i.check_out,
      i.hours_worked,
      i.amount,
      i.notes,
      cl.name AS location_name
    FROM inspections i
    LEFT JOIN client_locations cl ON cl.id = i.location_id
    WHERE i.link_id = v_link.id
    ORDER BY i.check_in DESC
    LIMIT 20
  ) r;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_inspections(UUID, TEXT) TO anon;

-- ============================================================
-- STORAGE BUCKETS
-- (Execute only once — may fail if already exists, that's OK)
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-photos', 'employee-photos', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('client-pdfs', 'client-pdfs', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DO $$
BEGIN
  -- Employee photos: upload auth, read public, delete auth
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'employee_photos_upload') THEN
    CREATE POLICY "employee_photos_upload" ON storage.objects
      FOR INSERT TO authenticated WITH CHECK (bucket_id = 'employee-photos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'employee_photos_read') THEN
    CREATE POLICY "employee_photos_read" ON storage.objects
      FOR SELECT USING (bucket_id = 'employee-photos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'employee_photos_delete') THEN
    CREATE POLICY "employee_photos_delete" ON storage.objects
      FOR DELETE TO authenticated USING (bucket_id = 'employee-photos');
  END IF;
  -- Client PDFs
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'client_pdfs_upload') THEN
    CREATE POLICY "client_pdfs_upload" ON storage.objects
      FOR INSERT TO authenticated WITH CHECK (bucket_id = 'client-pdfs');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'client_pdfs_read') THEN
    CREATE POLICY "client_pdfs_read" ON storage.objects
      FOR SELECT USING (bucket_id = 'client-pdfs');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'client_pdfs_delete') THEN
    CREATE POLICY "client_pdfs_delete" ON storage.objects
      FOR DELETE TO authenticated USING (bucket_id = 'client-pdfs');
  END IF;
END $$;
