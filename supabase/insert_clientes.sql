-- =====================================================================
-- insert_clientes.sql
-- Inserir clientes da planilha Clientes.xlsx (aba "clientes")
-- 49 clientes (DUE GRANI aparecia 2x na planilha — unificado)
-- Não duplica: pula clientes que já existirem com o mesmo nome.
-- Cole no SQL Editor do Supabase.
-- =====================================================================

INSERT INTO clients (name, requires_supervision, supervision_visits_per_month, observations)
SELECT v.name, v.req_sup, v.sup_visits, v.obs
FROM (VALUES
  ('CENTRAL DO FRANGO',                    true,  NULL::int, 'Serviço: Qualidade · Frequência: Mensal · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('COLÔNIA LINDÓIA',                      true,  NULL, 'Serviço: Qualidade · Frequência: Quinzenal · Visita: 4h · Nutricionista: Juliany · Supervisão: Giovana'),
  ('COLÔNIA SÃO PEDRO',                    true,  NULL, 'Serviço: Qualidade · Frequência: Semanal · Visita: 2:30h · Nutricionista: Gabriel · Supervisão: Giovana'),
  ('COLÔNIA PRAIA GRANDE',                 true,  NULL, 'Serviço: Qualidade · Frequência: Quinzenal · Visita: 4h · Nutricionista: Juliany · Supervisão: Giovana'),
  ('COLÔNIA SOCORRO',                      true,  NULL, 'Serviço: Qualidade · Frequência: Quinzenal · Visita: 4h · Nutricionista: Juliany · Supervisão: Giovana'),
  ('COLÔNIA CAMPOS',                       true,  NULL, 'Serviço: Qualidade · Frequência: Mensal · Visita: 4h · Nutricionista: Juliany · Supervisão: Giovana'),
  ('THE COFFEE',                           false, NULL, 'Serviço: Qualidade · Frequência: Mensal · Visita: 2:30h · Nutricionista: Giovana'),
  ('ARCOLOR',                              false, NULL, 'Serviço: Gestão · Frequência: Semanal · Visita: 4h · Responsáveis: Giovana e Maria Fernanda'),
  ('URCA ATACADISTA - Lj. 04 Pq. Guarani', true,  NULL, 'Serviço: Qualidade · Frequência: Semanal · Visita: 2:30h · Nutricionista: Juliany · Supervisão: Giovana'),
  ('URCA ATACADISTA - Lj. 05 Jaçanã',      true,  NULL, 'Serviço: Qualidade · Frequência: Semanal · Visita: 2:30h · Nutricionista: Juliany · Supervisão: Giovana'),
  ('RAINHA DO TATUAPÉ',                    true,  NULL, 'Serviço: Qualidade · Frequência: Mensal · Visita: 2:30h · Nutricionista: Juliany · Supervisão: Giovana'),
  ('CASA VIRGÍNIA',                        true,  1,    'Serviço: Qualidade · Escala: 6x1 · Nutricionista: Talita · Supervisão: Mensal - Giovana'),
  ('DUE GRANI',                            true,  1,    'Serviço: Técnica (Josi, escala 5x2) + Qualidade (Vânia, 7h na semana) · Supervisão: Mensal - Giovana'),
  ('ESFIHA VERGUEIRO',                     true,  NULL, 'Serviço: Qualidade · Frequência: Semanal · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('MORI',                                 true,  NULL, 'Serviço: Qualidade · Frequência: Mensal · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('GRUPO TERRÁ (AMG)',                    true,  NULL, 'Serviço: Qualidade · Frequência: Semanal · Visita: 2:30h · Nutricionista: Gabriel · Supervisão: Giovana'),
  ('ZAN BAOLO',                            true,  NULL, 'Serviço: Qualidade · Frequência: Semanal · Visita: 2:30h · Nutricionista: Juliany · Supervisão: Giovana'),
  ('DURICO',                               false, NULL, 'Serviço: Projeto de layout (pontual, sem escala)'),
  ('PIZZARIA FIORESI',                     true,  NULL, 'Serviço: Qualidade · Frequência: Semanal · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('AMÉRICA',                              true,  NULL, 'Serviço: Qualidade · Frequência: 2x no mês · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('KIYOMOTO',                             true,  NULL, 'Serviço: Qualidade · Frequência: Mensal · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('YAYA',                                 true,  NULL, 'Serviço: Qualidade · Frequência: Mensal · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('YAMATO',                               true,  NULL, 'Serviço: Qualidade · Frequência: Mensal · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('BEIRUTHE',                             true,  NULL, 'Serviço: Qualidade · Frequência: Mensal · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('MERCADINHO EXPRESSO',                  true,  NULL, 'Serviço: Qualidade · Frequência: Mensal · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('NOVA GUINÉ',                           true,  NULL, 'Serviço: Qualidade · Frequência: 2x no mês · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('TANKA RESTAURANTE',                    true,  2,    'Serviço: Qualidade · Frequência: Semanal · Visita: 2:30h · Nutricionista: Francislene · Supervisão: Quinzenal - Giovana'),
  ('SERRAS ESPETARIA',                     true,  NULL, 'Serviço: Qualidade · Frequência: Semanal · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('TAIYOO RESTAURANTE/MARKET',            false, NULL, 'Serviço: Qualidade · Frequência: Semanal · Visita: 2:30h · Nutricionista: Giovana'),
  ('AZEITE BOM DIA',                       false, NULL, 'Serviço: RT (Responsabilidade Técnica)'),
  ('ORQUIDÁRIO ORIENTAL',                  true,  NULL, 'Serviço: Qualidade · Frequência: Semanal · Visita: 2:30h · Nutricionista: Ariane · Supervisão: Giovana'),
  ('ESPETARIA CONS. CARRÃO',               true,  2,    'Serviço: Qualidade · Frequência: 48h mensais · Nutricionista: Juliany · Supervisão: Quinzenal - Giovana'),
  ('ESTAÇÃO HIGIENÓPOLIS',                 true,  NULL, 'Serviço: Qualidade · Frequência: Mensal · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('PROPHETA PIZZARIA - Unidade 1',        true,  NULL, 'Serviço: Qualidade · Frequência: 4x no mês · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('PROPHETA PIZZARIA - Unidade 3',        true,  NULL, 'Serviço: Qualidade · Frequência: 2x no mês · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('PROPHETA PIZZARIA - Unidade 4',        true,  NULL, 'Serviço: Qualidade · Frequência: 2x no mês · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('PROPHETA PIZZARIA - Unidade 5',        true,  NULL, 'Serviço: Qualidade · Frequência: 2x no mês · Visita: 2:30h · Nutricionista: Vânia · Supervisão: Giovana'),
  ('GRSA (Paraíba) - HNSN',                true,  NULL, 'Serviço: Qualidade · Supervisão sem escala · Nutricionista: Helen Cácia · Supervisão: Maria Fernanda'),
  ('GRSA - Hospital Assunção',             true,  NULL, 'Serviço: Qualidade · Supervisão: Maria Fernanda'),
  ('GRSA - Hospital Brasil (lactário)',    true,  NULL, 'Serviço: Qualidade · Escala: 5x2 · Nutricionista: Vitoria · Supervisão: Maria Fernanda'),
  ('GRSA - Hospital Brasil (cozinha)',     true,  NULL, 'Serviço: Qualidade · Escala: 12x36 · Equipe: Carla, Mikaelly, Lilian Isabel, Guilherme, Débora, Joana, Daniella, Simone, Giovanna · Supervisão: Maria Fernanda'),
  ('GRSA - Hospital Bartira',              true,  NULL, 'Serviço: Qualidade · Supervisão: Maria Fernanda'),
  ('GRSA - Hospital São Luiz Osasco',      true,  NULL, 'Serviço: Qualidade · Supervisão: Maria Fernanda'),
  ('SIG/TROFI - TEC',                      true,  NULL, 'Serviço: Qualidade · Frequência: 2x na semana · Visita: 4h · Nutricionista: Ana Carolina · Supervisão: Maria Fernanda'),
  ('SIG/TROFI - GUARAPIRANGA',             true,  NULL, 'Serviço: Qualidade · Frequência: 2x na semana · Visita: 4h · Nutricionista: Ana Carolina · Supervisão: Maria Fernanda'),
  ('SIG/CUBO',                             true,  NULL, 'Serviço: Qualidade · Frequência: 3x na semana · Visita: 4h · Nutricionista: Ana Carolina · Supervisão: Maria Fernanda'),
  ('LBGS - Hospital Tatuapé',              true,  NULL, 'Serviço: Qualidade · Supervisão sem escala · Nutricionista: Mirella · Supervisão: Maria Fernanda'),
  ('SOLUÇÕES - PONTA GROSSA',              true,  NULL, 'Serviço: Qualidade · Escala: 5x2 · Equipe: Lucas Lage, Ornella Ferri, Hellen Santana, Isabelli Poliani (atuação em Curitiba) · Supervisão: Maria Fernanda'),
  ('GSH',                                  false, NULL, 'Serviço: Qualidade · Escala: 6x1 conforme gestão GSH · Equipe: Jennifer, Nathalia Aparecida, Ana Pedroso, Eudócia, Beatriz Alessandra, Ana Beatriz')
) AS v(name, req_sup, sup_visits, obs)
WHERE NOT EXISTS (
  SELECT 1 FROM clients c WHERE lower(trim(c.name)) = lower(trim(v.name))
);

-- Total: 49 clientes
NOTIFY pgrst, 'reload schema';
