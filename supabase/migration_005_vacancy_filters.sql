-- migration_005_vacancy_filters.sql
-- Novos filtros de perfil de candidato na tabela de vagas

ALTER TABLE vacancies
  ADD COLUMN IF NOT EXISTS min_experience TEXT,          -- 'Mais de 1 ano' | 'Mais de 3 anos' | 'Mais de 5 anos'
  ADD COLUMN IF NOT EXISTS area_interest  TEXT[],        -- ['UAN', 'Nutrição Clínica', ...]
  ADD COLUMN IF NOT EXISTS segments       TEXT[],        -- ['Restaurantes comerciais', 'Hospitais', ...]
  ADD COLUMN IF NOT EXISTS uan_areas      TEXT[],        -- ['Planejamento', 'Controle de Qualidade', ...]
  ADD COLUMN IF NOT EXISTS shift          TEXT,          -- 'Diurno' | 'Noturno' | 'Ambos'
  ADD COLUMN IF NOT EXISTS work_scale     TEXT[],        -- ['5x2', '12x36', ...]
  ADD COLUMN IF NOT EXISTS contract_types TEXT[],        -- ['CLT', 'PJ', 'Freelancer', ...]
  ADD COLUMN IF NOT EXISTS start_availability TEXT,      -- 'Imediato' | 'Até 15 dias' | '30 dias ou mais'
  ADD COLUMN IF NOT EXISTS weekend_availability BOOLEAN; -- true = exige disponibilidade p/ fins de semana
