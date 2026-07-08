-- =====================================================================
-- insert_clientes.sql
-- Inserir os 49 clientes da planilha Clientes.xlsx (aba "clientes")
-- Só o nome — CNPJ, endereço, contato etc. podem ser editados depois
-- pelo botão "Editar" na página de cada cliente.
-- Supervisão: só os 4 com frequência marcada na planilha
-- (Casa Virgínia e Due Grani: mensal · Tanka e Espetaria Carrão: quinzenal),
-- com a Giovana como responsável (se ela tiver perfil de usuário).
-- Não duplica: pula clientes que já existirem com o mesmo nome.
-- Cole no SQL Editor do Supabase.
-- =====================================================================

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
NOTIFY pgrst, 'reload schema';
