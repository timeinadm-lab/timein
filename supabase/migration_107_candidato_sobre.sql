-- ============================================================
-- Migration 107 — Candidato: resposta aberta do formulário
-- ------------------------------------------------------------
-- Pedido do Gabriel (18/11/2026): o Forms ganhou a pergunta "Conte um pouco
-- sobre você e sua experiência na área de UAN (unidade de alimentação e
-- nutrição)". É texto livre e pode ser bem longo. A importação de candidatos
-- passa a guardar essa resposta e a ficha do candidato mostra.
-- Só acrescenta uma coluna. Não apaga nada. Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE candidates ADD COLUMN IF NOT EXISTS sobre text;

NOTIFY pgrst, 'reload schema';

-- Conferência: deve voltar 1
SELECT count(*) AS deve_dar_1 FROM information_schema.columns
 WHERE table_name = 'candidates' AND column_name = 'sobre';
