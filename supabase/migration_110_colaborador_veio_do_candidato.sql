-- ============================================================
-- Migration 110 — Colaborador guarda de qual candidato veio
-- ------------------------------------------------------------
-- Pedido do Gabriel (19/11/2026): a aba Vagas saiu. O candidato agora vira
-- colaborador pelo botão "Contratar" na ficha dele. Esta coluna liga os dois,
-- para a ficha do candidato mostrar "Ver ficha de colaborador" e ninguém ser
-- cadastrado duas vezes.
-- Também preenche quem já tinha sido contratado pelas vagas antigas.
-- Não apaga nada (as vagas antigas continuam guardadas). Pode rodar de novo.
-- ============================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES candidates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS employees_candidate_id_idx ON employees (candidate_id);

UPDATE employees e
   SET candidate_id = vi.candidate_id
  FROM (SELECT DISTINCT ON (employee_id) employee_id, candidate_id
          FROM vacancy_interests
         WHERE employee_id IS NOT NULL AND candidate_id IS NOT NULL
         ORDER BY employee_id, hired_at DESC NULLS LAST) vi
 WHERE vi.employee_id = e.id AND e.candidate_id IS NULL;

NOTIFY pgrst, 'reload schema';

-- Conferência
SELECT count(*) AS colaboradores, count(candidate_id) AS vieram_de_candidato FROM employees;
