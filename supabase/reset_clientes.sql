-- =====================================================================
-- reset_clientes.sql
-- PARTE 1: apaga TODOS os clientes (e o que depende deles)
-- PARTE 2: adiciona os 49 clientes da planilha
-- Cole no SQL Editor do Supabase e rode.
-- =====================================================================

-- ─── PARTE 1: APAGAR TUDO ────────────────────────────────────────────
-- Atenção: junto com os clientes caem também unidades, vínculos
-- colaborador↔cliente e inspeções ligadas a eles (cascade).
-- Vagas não são apagadas — só ficam sem cliente associado.

DELETE FROM client_units;
DELETE FROM client_contracts;
DELETE FROM clients;

-- ─── PARTE 2: ADICIONAR OS 49 CLIENTES ───────────────────────────────
-- Só o nome — CNPJ, endereço, contato etc. editáveis depois no botão
-- "Editar" de cada cliente. Supervisão: só os 4 com frequência marcada,
-- com a Giovana como responsável (se ela tiver perfil de usuário).

INSERT INTO clients (name, requires_supervision, supervision_visits_per_month, supervisor_id)
SELECT
  v.name,
  v.req_sup,
  v.sup_visits,
  CASE WHEN v.req_sup
    THEN (SELECT id FROM user_profiles WHERE full_name ILIKE '%giovana%' LIMIT 1)
  END
FROM (VALUES
  ('CENTRAL DO FRANGO',                    false, NULL::int),
  ('COLÔNIA LINDÓIA',                      false, NULL),
  ('COLÔNIA SÃO PEDRO',                    false, NULL),
  ('COLÔNIA PRAIA GRANDE',                 false, NULL),
  ('COLÔNIA SOCORRO',                      false, NULL),
  ('COLÔNIA CAMPOS',                       false, NULL),
  ('THE COFFEE',                           false, NULL),
  ('ARCOLOR',                              false, NULL),
  ('URCA ATACADISTA - Lj. 04 Pq. Guarani', false, NULL),
  ('URCA ATACADISTA - Lj. 05 Jaçanã',      false, NULL),
  ('RAINHA DO TATUAPÉ',                    false, NULL),
  ('CASA VIRGÍNIA',                        true,  1),
  ('DUE GRANI',                            true,  1),
  ('ESFIHA VERGUEIRO',                     false, NULL),
  ('MORI',                                 false, NULL),
  ('GRUPO TERRÁ (AMG)',                    false, NULL),
  ('ZAN BAOLO',                            false, NULL),
  ('DURICO',                               false, NULL),
  ('PIZZARIA FIORESI',                     false, NULL),
  ('AMÉRICA',                              false, NULL),
  ('KIYOMOTO',                             false, NULL),
  ('YAYA',                                 false, NULL),
  ('YAMATO',                               false, NULL),
  ('BEIRUTHE',                             false, NULL),
  ('MERCADINHO EXPRESSO',                  false, NULL),
  ('NOVA GUINÉ',                           false, NULL),
  ('TANKA RESTAURANTE',                    true,  2),
  ('SERRAS ESPETARIA',                     false, NULL),
  ('TAIYOO RESTAURANTE/MARKET',            false, NULL),
  ('AZEITE BOM DIA',                       false, NULL),
  ('ORQUIDÁRIO ORIENTAL',                  false, NULL),
  ('ESPETARIA CONS. CARRÃO',               true,  2),
  ('ESTAÇÃO HIGIENÓPOLIS',                 false, NULL),
  ('PROPHETA PIZZARIA - Unidade 1',        false, NULL),
  ('PROPHETA PIZZARIA - Unidade 3',        false, NULL),
  ('PROPHETA PIZZARIA - Unidade 4',        false, NULL),
  ('PROPHETA PIZZARIA - Unidade 5',        false, NULL),
  ('GRSA (Paraíba) - HNSN',                false, NULL),
  ('GRSA - Hospital Assunção',             false, NULL),
  ('GRSA - Hospital Brasil (lactário)',    false, NULL),
  ('GRSA - Hospital Brasil (cozinha)',     false, NULL),
  ('GRSA - Hospital Bartira',              false, NULL),
  ('GRSA - Hospital São Luiz Osasco',      false, NULL),
  ('SIG/TROFI - TEC',                      false, NULL),
  ('SIG/TROFI - GUARAPIRANGA',             false, NULL),
  ('SIG/CUBO',                             false, NULL),
  ('LBGS - Hospital Tatuapé',              false, NULL),
  ('SOLUÇÕES - PONTA GROSSA',              false, NULL),
  ('GSH',                                  false, NULL)
) AS v(name, req_sup, sup_visits)
WHERE NOT EXISTS (
  SELECT 1 FROM clients c WHERE lower(trim(c.name)) = lower(trim(v.name))
);

-- Total: 49 clientes · Supervisão: Casa Virgínia (1x/mês), Due Grani (1x/mês),
-- Tanka (2x/mês), Espetaria Cons. Carrão (2x/mês)

-- ─── PARTE 3: UNIDADE POR CLIENTE (mesmo nome do cliente) ────────────
-- Ex.: cliente "AMÉRICA" → unidade "AMÉRICA". É onde o valor da visita
-- fica amarrado na consultoria.
INSERT INTO client_units (client_id, name)
SELECT c.id, c.name
FROM clients c
WHERE NOT EXISTS (
  SELECT 1 FROM client_units u
  WHERE u.client_id = c.id AND lower(trim(u.name)) = lower(trim(c.name))
);

NOTIFY pgrst, 'reload schema';
