-- ============================================================
-- Migration 080 — Auditoria: e-mail do consultor e checklist MELI completo
-- ------------------------------------------------------------
-- 1. Cabeçalho igual ao do MELI: Cliente / Consultor(a) / E-mail / Data das… às…
--    → auditorias ganha "auditor_email".
-- 2. No checklist MELI da 079, seis perguntas da seção "Processo" entraram
--    grudadas em duas. Aqui elas viram seis (fica com 130, igual ao Food Checker).
--    Só muda o checklist; auditorias já criadas não mudam.
-- Não apaga nada. Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE auditorias ADD COLUMN IF NOT EXISTS auditor_email text;

DO $$
DECLARE
  m  uuid := '7e1e0000-0000-4000-8000-000000000001';
  a  auditoria_perguntas%ROWTYPE;   -- "O fluxo do pré-preparo… Carnes… As bancadas…"
  b  auditoria_perguntas%ROWTYPE;   -- "(Observação da troca…) Utensílios… placas… Não há contato…"
BEGIN
  SELECT * INTO a FROM auditoria_perguntas
   WHERE modelo_id = m AND texto LIKE 'O fluxo do pré-preparo evita%Carnes, hortifrúti%' LIMIT 1;
  SELECT * INTO b FROM auditoria_perguntas
   WHERE modelo_id = m AND texto LIKE '(Observação da troca de processo%Não há contato%' LIMIT 1;
  IF a.id IS NULL OR b.id IS NULL THEN RETURN; END IF;   -- já corrigido

  -- abre espaço para 4 perguntas depois da segunda
  UPDATE auditoria_perguntas SET ordem = ordem + 4 WHERE modelo_id = m AND ordem > b.ordem;

  UPDATE auditoria_perguntas SET texto = 'O fluxo do pré-preparo evita o cruzamento entre alimentos crus, higienizados e prontos para consumo? (Observação do fluxo e fotografia da área)'
   WHERE id = a.id;
  UPDATE auditoria_perguntas SET texto = 'Não há contato de caixas externas, embalagens de transporte ou objetos pessoais com bancadas limpas?', ordem = b.ordem + 4
   WHERE id = b.id;

  INSERT INTO auditoria_perguntas (modelo_id, grupo, secao, texto, peso, ordem) VALUES
    (m, a.grupo, a.secao, 'Carnes, hortifrúti e alimentos prontos são manipulados em áreas, bancadas ou horários separados? (Acompanhamento da operação e fotografia as áreas)', a.peso, b.ordem),
    (m, a.grupo, a.secao, 'As bancadas são higienizadas entre diferentes atividades e tipos de alimentos? (Observação da troca de processo e fotografia do processo)', a.peso, b.ordem + 1),
    (m, a.grupo, a.secao, 'Utensílios e equipamentos são higienizados entre o uso com alimentos crus e prontos? (Placas de corte, facas, cubas, processadores e fatiadores)', a.peso, b.ordem + 2),
    (m, a.grupo, a.secao, 'As placas de corte e os utensílios são diferenciados por tipo de alimento ou possuem outro controle eficaz? Código de cores, identificação ou procedimento (Observar e fotografar)', a.peso, b.ordem + 3);
END$$;

NOTIFY pgrst, 'reload schema';

-- Conferência: tem que dar Estrutura 32 e Boas Práticas 98
SELECT grupo, count(*) AS perguntas FROM auditoria_perguntas
 WHERE modelo_id = '7e1e0000-0000-4000-8000-000000000001' AND ativo
 GROUP BY grupo ORDER BY grupo DESC;
