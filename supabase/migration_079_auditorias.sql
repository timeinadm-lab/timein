-- ============================================================
-- Migration 079 — Auditorias com checklist e relatório próprio
-- ------------------------------------------------------------
-- Pedido de 04/10/2026: o Mercado Livre (MELI) quer, num relatório só,
-- a nota com peso (Estrutura peso 1, Boas Práticas peso 2), o gráfico de
-- barras de não conformidade por grupo e TODAS as perguntas com
-- C / NC / N/A, o peso ao lado, a observação e as fotos — sem a pizza.
-- O Food Checker não faz isso; a auditoria passa a ser feita aqui.
--
-- Modelos de checklist (perguntas com grupo, seção e peso) e as auditorias.
-- Cada auditoria guarda uma cópia das perguntas no dia: editar o modelo
-- depois não muda auditoria já feita.
-- Já vem com o "Checklist MELI" (126 perguntas, do PDF de exemplo).
-- Não mexe em nada que já existe. Pode rodar mais de uma vez.
-- ============================================================

CREATE TABLE IF NOT EXISTS auditoria_modelos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text NOT NULL,
  descricao  text,
  -- Faixas da classificação: nota mínima (inteira) de cada uma, da maior para a menor
  faixas     jsonb NOT NULL DEFAULT '[{"min":91,"rotulo":"Excelente"},{"min":80,"rotulo":"Satisfatório"},{"min":50,"rotulo":"Insatisfatório"},{"min":0,"rotulo":"Crítico"}]'::jsonb,
  ativo      boolean NOT NULL DEFAULT true,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auditoria_perguntas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id  uuid NOT NULL REFERENCES auditoria_modelos(id) ON DELETE CASCADE,
  grupo      text NOT NULL,
  secao      text,
  texto      text NOT NULL,
  peso       numeric(4,1) NOT NULL DEFAULT 1 CHECK (peso > 0),
  ordem      int NOT NULL DEFAULT 0,
  ativo      boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS auditoria_perguntas_modelo ON auditoria_perguntas (modelo_id, ordem);

CREATE TABLE IF NOT EXISTS auditorias (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id      uuid REFERENCES auditoria_modelos(id) ON DELETE SET NULL,
  titulo         text NOT NULL,
  faixas         jsonb NOT NULL,
  client_id      uuid REFERENCES clients(id) ON DELETE SET NULL,
  unidade        text,
  concessionaria text,
  auditor_id     uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  auditor_nome   text,
  data           date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  inicio         time,
  fim            time,
  observacoes    text,
  status         text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'finalizada')),
  nota           numeric(5,1),
  finalizada_em  timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auditorias_data ON auditorias (data DESC);

CREATE TABLE IF NOT EXISTS auditoria_respostas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auditoria_id  uuid NOT NULL REFERENCES auditorias(id) ON DELETE CASCADE,
  pergunta_id   uuid REFERENCES auditoria_perguntas(id) ON DELETE SET NULL,
  grupo         text NOT NULL,
  secao         text,
  texto         text NOT NULL,
  peso          numeric(4,1) NOT NULL,
  ordem         int NOT NULL,
  resposta      text CHECK (resposta IN ('C', 'NC', 'NA')),
  observacao    text,
  fotos         text[] NOT NULL DEFAULT '{}',
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auditoria_respostas_aud ON auditoria_respostas (auditoria_id, ordem);

-- Só a equipe logada (e liberada, se a 077 já rodou)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['auditoria_modelos', 'auditoria_perguntas', 'auditorias', 'auditoria_respostas'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS equipe_usa ON %I', t);
    EXECUTE format('CREATE POLICY equipe_usa ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'eh_da_equipe') THEN
      EXECUTE format('DROP POLICY IF EXISTS so_equipe ON %I', t);
      EXECUTE format('CREATE POLICY so_equipe ON %I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT eh_da_equipe())) WITH CHECK ((SELECT eh_da_equipe()))', t);
    END IF;
  END LOOP;
END$$;

-- ── Checklist MELI ───────────────────────────────────────────────────────
INSERT INTO auditoria_modelos (id, nome, descricao)
VALUES ('7e1e0000-0000-4000-8000-000000000001', 'Checklist MELI', 'Mercado Livre — Estrutura (peso 1: responsabilidade do MELI) e Boas Práticas (peso 2: responsabilidade da concessionária)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auditoria_perguntas (modelo_id, grupo, secao, texto, peso, ordem)
SELECT modelo_id::uuid, grupo, secao, texto, peso, ordem FROM (VALUES
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Pisos com revestimento liso, impermeável e lavável?$t$, 1, 1),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Pisos em adequado estado de conservação, livre de trincas, rachaduras, infiltrações e outros?$t$, 1, 2),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Tetos de revestimento liso, impermeável e lavável?$t$, 1, 3),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Tetos em adequado estado de conservação, livre de trincas, rachaduras, infiltração, goteiras, vazamentos, bolores, descascamentos e outros?$t$, 1, 4),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Tetos higienizados?$t$, 1, 5),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Paredes e divisórias com revestimento liso, impermeável e lavável?$t$, 1, 6),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Paredes e divisórias em adequado estado de conservação, livres de trincas, rachaduras, infiltrações, bolores, descascamentos e outros?$t$, 1, 7),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Portas da área de preparação e armazenamento de alimentos, dotadas de fechamento automático, telas milimétricas (se necessário) e ajustadas ao batente?$t$, 1, 8),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Janelas e outras aberturas das áreas de armazenamento e preparação de alimentos, inclusive o sistema de exaustão, providas de telas milimetradas e ajustadas aos batentes para impedir o acesso de vetores e pragas urbanas?$t$, 1, 9),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Telas íntegras e higienizadas?$t$, 1, 10),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Banheiros e vestiários sem comunicação direta com a área de preparação ou armazenamento de alimentos?$t$, 1, 11),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Banheiros e vestiários mantidos em adequado estado de conservação?$t$, 1, 12),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Portas dos banheiros e vestiários dotadas de fechamento automático?$t$, 1, 13),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Banheiros providos de pias para lavagem das mãos?$t$, 1, 14),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Existência de pias exclusivas para a higiene das mãos na área de manipulação, em posições estratégicas em relação ao fluxo de preparo dos alimentos e em número suficiente de modo a atender toda a área de preparação?$t$, 1, 15),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Iluminação adequada e sem sombras?$t$, 1, 16),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Luminárias localizadas sobre as áreas de preparação ou distribuição dos alimentos estão protegidas contra explosão e quedas acidentais?$t$, 1, 17),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Instalações elétricas embutidas ou protegidas em tubulações externas e íntegras de tal forma a permitir a higienização dos ambientes?$t$, 1, 18),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$A ventilação garante a renovação do ar e a manutenção do ambiente, livre de fungos, gases, fumaça, pós, partículas em suspensão, condensação de vapores dentre outros que possam comprometer a qualidade higiênico-sanitária do alimento?$t$, 1, 19),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Não evidenciada a presença de ventiladores nas áreas de manipulação de alimentos?$t$, 1, 20),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Equipamentos e filtros para climatização conservados?$t$, 1, 21),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Existe evidência da limpeza dos equipamentos do sistema de climatização, troca de filtros e manutenção periódica?$t$, 1, 22),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Ralos sifonados e grelhas com dispositivo que permitam seu fechamento?$t$, 1, 23),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Caixas de gordura e esgoto localizadas fora da área de preparação ou armazenamento de alimentos, em adequado estado de conservação e funcionamento?$t$, 1, 24),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Edificação e instalações projetadas de forma a possibilitar um fluxo ordenado e sem cruzamentos em todas as etapas da preparação de alimentos facilitando as operações de manutenção e limpeza?$t$, 1, 25),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Equipamentos em perfeito estado de conservação e isentos de improvisações?$t$, 1, 26),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$É realizada manutenção programada e periódica dos equipamentos e utensílios?$t$, 1, 27),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Lixeiras providas de tampas acionadas por pedais e em bom estado de funcionamento e conservação?$t$, 1, 28),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$As câmaras e outros equipamentos de refrigeração estão em bom estado de conservação?$t$, 1, 29),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$Lixeiras externas com capacidade adequada e encontram-se fechadas?$t$, 1, 30),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$A área onde se encontra o gás (GLP) é exclusiva, provida de grades e com boa ventilação?$t$, 1, 31),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Estrutura$g$, $s$Edificação e Instalações$s$, $t$A área do serviço de alimentação onde se realiza a atividade de recebimento de dinheiro, cartões e outros meios utilizados para o pagamento de despesas, é reservada?$t$, 1, 32),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, NULL, $t$Área externa do estabelecimento está livre de objetos em desuso ou estranhos ao ambiente?$t$, 2, 33),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, NULL, $t$Área interna do estabelecimento está livre de objetos em desuso ou estranhos ao ambiente?$t$, 2, 34),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, NULL, $t$Banheiros e vestiários mantidos organizados?$t$, 2, 35),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, NULL, $t$Pias dotadas de sabonete líquido inodoro antisséptico ou sabonete líquido inodoro + produto antisséptico, toalhas de papel não reciclado ou outro sistema higiênico e seguro de secagem das mãos e coletor de papel, acionados sem contato manual?$t$, 2, 36),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, NULL, $t$Coletores dos resíduos dos banheiros dotados de tampa e acionados sem contato manual?$t$, 2, 37),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Recebimento e Armazenamento$s$, $t$Possuem procedimento especificando os critérios para avaliação e seleção de fornecedores de matérias-primas, ingredientes e embalagens?$t$, 2, 38),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Recebimento e Armazenamento$s$, $t$O recebimento de mercadorias é realizada em área protegida e limpa?$t$, 2, 39),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Recebimento e Armazenamento$s$, $t$Durante o recebimento é realizada a verificação de temperatura, condições da embalagem, rotulagem (RDC 429 e IN 75 de 2020), condições do produto e estas informações são registradas?$t$, 2, 40),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Recebimento e Armazenamento$s$, $t$Na área de recebimento possuem paletes para apoio adequado das mercadorias?$t$, 2, 41),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Recebimento e Armazenamento$s$, $t$Os produtos estão armazenados em local limpo e organizado?$t$, 2, 42),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Recebimento e Armazenamento$s$, $t$Os produtos armazenados encontram-se dentro do prazo de validade?$t$, 2, 43),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Recebimento e Armazenamento$s$, $t$Sistema PVPS encontra-se implantado?$t$, 2, 44),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Recebimento e Armazenamento$s$, $t$Nos estoques, os produtos estão armazenados sobre paletes, estrados e/ou prateleiras de material liso, resistente, impermeável e lavável, respeitando o espaçamento mínimo necessário para garantir adequada ventilação, limpeza e, quando for o caso, desinfecção do local?$t$, 2, 45),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Recebimento e Armazenamento$s$, $t$Todos os produtos armazenados (matéria prima, fracionados, processados ou acabados) encontram-se devidamente etiquetados?$t$, 2, 46),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Recebimento e Armazenamento$s$, $t$Antes de serem enviados à cozinha, os produtos são retirados das caixas de papelão?$t$, 2, 47),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Recebimento e Armazenamento$s$, $t$As câmaras e outros equipamentos de refrigeração encontram-se organizados?$t$, 2, 48),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Higienização$s$, $t$Higienização das instalações é adequada e realizada com frequência?$t$, 2, 49),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Higienização$s$, $t$Existe registro das operações de limpeza realizadas não rotineiramente?$t$, 2, 50),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Higienização$s$, $t$Produtos saneantes utilizados, são regularizados no Ministério da Saúde? As fichas técnicas e as fichas de segurança dos produtos estão disponíveis?$t$, 2, 51),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Higienização$s$, $t$Diluição e tempo de contato e modo de uso/aplicação dos produtos saneantes obedecem às instruções recomendadas pelo fabricante?$t$, 2, 52),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Higienização$s$, $t$Produtos de higienização são guardados em local reservado para essa finalidade?$t$, 2, 53),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Higienização$s$, $t$Equipamentos e utensílios se encontram higienizados?$t$, 2, 54),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Higienização$s$, $t$Luminárias, interruptores e tomadas se encontram higienizados?$t$, 2, 55),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Higienização$s$, $t$Pisos são mantidos secos e sem resíduos de produção ou outros detritos?$t$, 2, 56),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Higienização$s$, $t$Paredes, azulejos, divisórias e portas se encontram higienizados?$t$, 2, 57),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Higienização$s$, $t$Ralos sem resíduos e higienizados?$t$, 2, 58),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Higienização$s$, $t$Existe evidencia de limpeza dos filtros das coifas e exaustores?$t$, 2, 59),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Higienização$s$, $t$Utilizam panos descartáveis e seu descarte é adequado?$t$, 2, 60),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Higienização$s$, $t$Caixas de gordura são periodicamente limpas? Quando foi realizada a última limpeza?$t$, 2, 61),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Higienização$s$, $t$O descarte de óleo queimado é realizado através de empresa especializada? Existe comprovante de retiradas constantes?$t$, 2, 62),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Equipamentos e Utensílios$s$, $t$Utensílios adequados, constituídos de material atóxico, ausente de frestas, não permitindo o acúmulo de sujidades?$t$, 2, 63),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Equipamentos e Utensílios$s$, $t$Durante a produção, é feita a retirada frequente dos resíduos da área de processamento, evitando focos de contaminação?$t$, 2, 64),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$As áreas são divididas de acordo com a atividade desenvolvida e encontram-se organizadas?$t$, 2, 65),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$Evita-se o contato direto ou indireto entre alimentos crus, semipreparados e prontos para o consumo?$t$, 2, 66),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$O fluxo do pré-preparo evita o cruzamento entre alimentos crus, higienizados e prontos para consumo? (Observação do fluxo e fotografia da área) Carnes, hortifrúti e alimentos prontos são manipulados em áreas, bancadas ou horários separados? (Acompanhamento da operação e fotografia as áreas) As bancadas são higienizadas entre diferentes atividades e tipos de alimentos?$t$, 2, 67),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$(Observação da troca de processo e fotografia do processo) Utensílios e equipamentos são higienizados entre o uso com alimentos crus e prontos? (Placas de corte, facas, cubas, processadores e fatiadores) As placas de corte e os utensílios são diferenciados por tipo de alimento ou possuem outro controle eficaz? Código de cores, identificação ou procedimento (Observar e fotografar) Não há contato de caixas externas, embalagens de transporte ou objetos pessoais com bancadas limpas?$t$, 2, 68),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$O processo de descongelamento ocorre de modo seguro, em temperatura inferior a 5°C, evitando a contaminação dos produtos? Os produtos estão devidamente identificados/ controlados por meio de planilha de descongelamento?$t$, 2, 69),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$As matérias-primas e os ingredientes caracterizados como produtos perecíveis estão expostos à temperatura ambiente somente pelo tempo mínimo necessário para a preparação do alimento, a fim de não comprometer a qualidade higiênicosanitária do alimento preparado (no máximo 30 minutos)?$t$, 2, 70),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$Após o pré-preparo, os alimentos são protegidos, identificados e armazenados imediatamente?$t$, 2, 71),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$Após a abertura ou retirada da embalagem original as matérias-primas e os ingredientes que não forem utilizados em sua totalidade, são adequadamente acondicionados e identificados com, no mínimo, as seguintes informações: designação do produto, data de fracionamento e novo prazo de validade; para produtos transferidos da embalagem original considerar também a inclusão de lote, marca e, para itens de origem animal, SIF?$t$, 2, 72),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$Os FLV são selecionados antes da higienização, com retirada de partes deterioradas, sujidades e corpos estranhos? A lavagem inicial é realizada individualmente ou folha a folha, em água corrente potável?$t$, 2, 73),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$O produto utilizado é regularizado e indicado especificamente para higienização de alimentos?$t$, 2, 74),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$A diluição é realizada conforme o rótulo ou procedimento aprovado pela unidade? São utilizados medidores padronizados para preparar a solução?$t$, 2, 75),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$A concentração da solução é monitorada, quando aplicável? O tempo de contato é controlado conforme orientação do fabricante?$t$, 2, 76),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$O enxágue é realizado quando indicado pelo fabricante, utilizando água corrente potável?$t$, 2, 77),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$Existe controle ou registro da higienização dos FLV?$t$, 2, 78),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$Após a sanitização, os FLV são manipulados somente com mãos e utensílios devidamente higienizados? Após a higienização, os FLV são mantidos protegidos, identificados e sob refrigeração até o momento da utilização?$t$, 2, 79),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$O tratamento térmico dos alimentos durante a cocção, garante que todas as partes dos alimento atinja, no mínimo, 75°C? Este controle é realizado em todos os horários (almoço, jantar e ceia)? Existe registro desta operação?$t$, 2, 80),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$Os alimentos cozidos e servidos frios, possuem suas temperaturas reduzidas de 60°C a 10°C, em até 2 horas? Este controle é realizado em todos os serviços (almoço, jantar e ceia)? Existe registro desta operação?$t$, 2, 81),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$Após serem submetidos à cocção, os alimentos preparados são mantidos à temperatura superior a 60ºC, por, no máximo, 6 horas? Este controle é realizado em todos os serviços (almoço, jantar e ceia)? Existe registro desta operação?$t$, 2, 82),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$As câmaras e outros equipamentos de refrigeração, como geladeiras e freezers, possuem suas temperaturas regularmente monitorada e registrada?$t$, 2, 83),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$Os funcionários responsáveis por essa atividade não manipulam alimentos preparados, embalados ou não?$t$, 2, 84),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Processo$s$, $t$As embalagens de produtos não são reutilizadas na produção ou na limpeza?$t$, 2, 85),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Manipuladores$s$, $t$A uniformização está adequada e em bom estado de conservação?$t$, 2, 86),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Manipuladores$s$, $t$Manipuladores com mãos limpas, unhas curtas, sem esmalte ou base, sem adornos (anéis, pulseiras, brincos, celulares, etc.), barba e maquiagem?$t$, 2, 87),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Manipuladores$s$, $t$Manipuladores com cabelos presos e protegidos por redes ou toucas?$t$, 2, 88),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Manipuladores$s$, $t$Cumpre-se as determinações de fumar ou comer apenas nos locais específicos ?$t$, 2, 89),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Manipuladores$s$, $t$Os colaboradores higienizam as mãos antes de iniciar a atividade e nas trocas de processo?$t$, 2, 90),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Manipuladores$s$, $t$Há troca adequada de luvas entre atividades, sem substituição da lavagem das mãos?$t$, 2, 91),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Manipuladores$s$, $t$Possuem cartazes de orientação aos manipuladores sobre a correta lavagem das mãos, afixados em locais de fácil visualização, inclusive nas instalações sanitárias e lavatórios?$t$, 2, 92),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Manipuladores$s$, $t$Os funcionários utilizam EPI's, quando necessário?$t$, 2, 93),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Manipuladores$s$, $t$Os atestados de saúde ocupacional se encontram atualizados conforme descrito no PCMSO?$t$, 2, 94),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Manipuladores$s$, $t$Existe registro de treinamento periódico em Boas Práticas na Manipulação de Alimentos?$t$, 2, 95),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Manipuladores$s$, $t$Possuem uniformes para visitantes (jaleco e touca descartável)?$t$, 2, 96),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Manipuladores$s$, $t$PGR e PCMSO dentro do prazo de vigência e atualizados conforme as características da Unidade?$t$, 2, 97),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Controle de Qualidade$s$, $t$Existe um responsável pelas atividades de manipulação dos alimentos, devidamente capacitado? Existe documento comprobatório (CMVS ou Licença Sanitária)?$t$, 2, 98),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Controle de Qualidade$s$, $t$O Manual de Boas Práticas e de Procedimentos Operacionais Padronizados, encontram-se adaptados as condições do estabelecimento, devidamente atualizado e implantado?$t$, 2, 99),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Controle de Qualidade$s$, $t$As amostras dos alimentos e bebidas servidos são coletados diariamente e em todos os serviços? Foram coletadas em quantidade adequada (Mínimo de 100g conforme preconiza a legislação sanitária vigente)?$t$, 2, 100),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Controle de Qualidade$s$, $t$As amostras estão armazenadas de forma organizada e conforme preconiza a legislação sanitária vigente?$t$, 2, 101),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Controle de Qualidade$s$, $t$Realizam análises microbiológicas periódicas em alimentos, conforme RDC 724 e IN 161? Qual a periodicidade das análises?$t$, 2, 102),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Controle de Qualidade$s$, $t$Os registros são mantidos por período mínimo de 30 dias, contados a partir da preparação dos alimentos?$t$, 2, 103),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Controle de Qualidade$s$, $t$Possuem registros de controle para monitoramento de sobra?$t$, 2, 104),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Controle de Qualidade$s$, $t$Possuem registros de controle para monitoramento de resto?$t$, 2, 105),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Controle Integrado de Pragas$s$, $t$Ausência de vetores e pragas urbanas ou qualquer evidência de sua presença como fezes, ninhos e outros?$t$, 2, 106),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Controle Integrado de Pragas$s$, $t$Existe programa de desratização e desinsetização?$t$, 2, 107),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Controle Integrado de Pragas$s$, $t$A empresa contratada para o Controle de Pragas possui licença sanitária atualizada?$t$, 2, 108),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Controle Integrado de Pragas$s$, $t$Armazenagem de venenos é feita em locais específicos e distantes de produtos alimentícios?$t$, 2, 109),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Controle Integrado de Pragas$s$, $t$Possuem registros para monitoramento da presença de pragas?$t$, 2, 110),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Controle Integrado de Pragas$s$, $t$Existe um mapeamento indicando a localização das iscas para roedores?$t$, 2, 111),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Abastecimento de Água$s$, $t$Quando utilizada solução alternativa de abastecimento de água, a potabilidade é atestada semestralmente mediante laudos laboratoriais?$t$, 2, 112),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Abastecimento de Água$s$, $t$O gelo para utilização em alimentos é fabricado a partir de água potável e mantido em condição higiênico-sanitária que evite sua contaminação?$t$, 2, 113),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Abastecimento de Água$s$, $t$São realizadas análises periódicas da água, para comprovação de sua potabilidade?$t$, 2, 114),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Abastecimento de Água$s$, $t$Reservatório de água higienizado adequadamente e realizada a cada 6 meses?$t$, 2, 115),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Distribuição$s$, $t$Os salões de distribuição encontram-se organizados e em adequadas condições higiênico-sanitárias?$t$, 2, 116),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Distribuição$s$, $t$Utensílios utilizados na área de consumo do alimento, tais como pratos, copos e talheres, quando feitos de material nãodescartável, encontram-se devidamente higienizados e armazenados em local protegido?$t$, 2, 117),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Distribuição$s$, $t$Os balcões de distribuição de alimentos (frios e quentes) preparados se encontram em adequado estado de higiene, conservação e funcionamento?$t$, 2, 118),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Distribuição$s$, $t$Temperatura desses equipamentos (balcões de distribuição frios e quentes) é regularmente monitorada e registrada? Este controle é realizado em todos os horários (desjejum, almoço, jantar e ceia)?$t$, 2, 119),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Distribuição$s$, $t$As reposições de preparações são realizadas sempre que necessário?$t$, 2, 120),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Distribuição$s$, $t$A temperatura dos alimentos em distribuição é monitorada e registrada? Este controle é realizado em todos os horários (desjejum, almoço, jantar e ceia)?$t$, 2, 121),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Distribuição$s$, $t$Produtos que aguardam a distribuição encontram-se armazenados em temperatura adequada?$t$, 2, 122),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Distribuição$s$, $t$Temperaturas dos passthroughs (quentes e frios) são regularmente monitoradas e registradas? Este controle é realizado em todos os horários (almoço, jantar e ceia)?$t$, 2, 123),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Distribuição$s$, $t$Sobras de preparações são desprezadas e não são reutilizadas no próximo turno?$t$, 2, 124),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Distribuição$s$, $t$Ornamentos e plantas localizados na área de consumo ou refeitório não constituem fonte de contaminação para os alimentos preparados?$t$, 2, 125),
  ('7e1e0000-0000-4000-8000-000000000001', $g$Boas Práticas$g$, $s$Distribuição$s$, $t$Não evidenciada a presença de pragas no salão de distribuição?$t$, 2, 126)
) AS v(modelo_id, grupo, secao, texto, peso, ordem)
WHERE NOT EXISTS (SELECT 1 FROM auditoria_perguntas WHERE modelo_id = '7e1e0000-0000-4000-8000-000000000001');

NOTIFY pgrst, 'reload schema';

-- Conferência: perguntas por grupo (esperado: Estrutura 32 · peso 1 / Boas Práticas 94 · peso 2)
SELECT grupo, count(*) AS perguntas, min(peso) AS peso
  FROM auditoria_perguntas WHERE modelo_id = '7e1e0000-0000-4000-8000-000000000001' GROUP BY grupo ORDER BY grupo DESC;
