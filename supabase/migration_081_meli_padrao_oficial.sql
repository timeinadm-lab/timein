-- ============================================================
-- Migration 081 — Checklist MELI no padrão oficial + foto obrigatória
-- ------------------------------------------------------------
-- Pedido de 05/10/2026 (após apresentar à cliente):
--  1. Perguntas na sequência do padrão MELI (relatório MG01 Extrema 21/08/2026):
--     126 perguntas em 10 seções, na ordem oficial. Cada pergunta mantém o
--     peso do seu grupo: Estrutura (responsabilidade MELI) = 1,
--     Boas Práticas (concessionária) = 2.
--  2. Faixas da nota do padrão: Excelente 90–100, Bom 75–89, Regular 60–74,
--     Inadequado abaixo de 60.
--  3. Pergunta pode exigir foto ("foto_obrigatoria"): as que pedem fotografia.
-- O checklist antigo é desativado (não apagado). Auditorias já feitas não mudam.
-- Pode rodar mais de uma vez.
-- ============================================================

ALTER TABLE auditoria_perguntas ADD COLUMN IF NOT EXISTS foto_obrigatoria boolean NOT NULL DEFAULT false;
ALTER TABLE auditoria_respostas ADD COLUMN IF NOT EXISTS foto_obrigatoria boolean NOT NULL DEFAULT false;

UPDATE auditoria_modelos
   SET faixas = '[{"min":90,"rotulo":"Excelente"},{"min":75,"rotulo":"Bom"},{"min":60,"rotulo":"Regular"},{"min":0,"rotulo":"Inadequado"}]'::jsonb,
       descricao = 'Mercado Livre — padrão oficial (126 perguntas). Estrutura peso 1 (responsabilidade MELI), Boas Práticas peso 2 (concessionária).'
 WHERE id = '7e1e0000-0000-4000-8000-000000000001';

DO $$
BEGIN
  -- já trocado? (pergunta que só existe no padrão novo)
  IF EXISTS (SELECT 1 FROM auditoria_perguntas WHERE modelo_id = '7e1e0000-0000-4000-8000-000000000001' AND ativo
              AND texto = 'Termômetros são calibrados e possuem registros da realização dessas operações?') THEN
    RETURN;
  END IF;
  UPDATE auditoria_perguntas SET ativo = false WHERE modelo_id = '7e1e0000-0000-4000-8000-000000000001' AND ativo;
  INSERT INTO auditoria_perguntas (modelo_id, grupo, secao, texto, peso, ordem, foto_obrigatoria)
  SELECT '7e1e0000-0000-4000-8000-000000000001'::uuid, v.grupo, v.secao, v.texto, v.peso, v.ordem, v.foto
    FROM (VALUES
  ($q$Boas Práticas$q$, $q$Edificação e Instalações$q$, $q$Área externa do estabelecimento está livre de objetos em desuso ou estranhos ao ambiente?$q$, 2, 1, false),
  ($q$Boas Práticas$q$, $q$Edificação e Instalações$q$, $q$Área interna do estabelecimento está livre de objetos em desuso ou estranhos ao ambiente?$q$, 2, 2, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Pisos com revestimento liso, impermeável e lavável?$q$, 1, 3, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Pisos em adequado estado de conservação, livre de trincas, rachaduras, infiltrações e outros?$q$, 1, 4, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Tetos de revestimento liso, impermeável e lavável?$q$, 1, 5, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Tetos em adequado estado de conservação, livre de trincas, rachaduras, infiltração, goteiras, vazamentos, bolores, descascamentos e outros?$q$, 1, 6, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Paredes e divisórias com revestimento liso, impermeável e lavável?$q$, 1, 7, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Paredes e divisórias em adequado estado de conservação, livres de trincas, rachaduras, infiltrações, bolores, descascamentos e outros?$q$, 1, 8, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Portas da área de preparação e armazenamento de alimentos, dotadas de fechamento automático, telas milimétricas (se necessário) e ajustadas ao batente?$q$, 1, 9, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Janelas e outras aberturas das áreas de armazenamento e preparação de alimentos, inclusive o sistema de exaustão, providas de telas milimetradas e ajustadas aos batentes para impedir o acesso de vetores e pragas urbanas?$q$, 1, 10, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Banheiros e vestiários sem comunicação direta com a área de preparação ou armazenamento de alimentos?$q$, 1, 11, false),
  ($q$Boas Práticas$q$, $q$Edificação e Instalações$q$, $q$Banheiros e vestiários mantidos organizados e em adequado estado de conservação?$q$, 2, 12, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Portas dos banheiros e vestiários dotadas de fechamento automático?$q$, 1, 13, false),
  ($q$Boas Práticas$q$, $q$Edificação e Instalações$q$, $q$Banheiros providos de pias para lavagem das mãos, abastecidas com sabonete líquido inodoro antisséptico ou sabonete líquido inodoro + produto antisséptico, toalhas de papel não reciclado ou outro sistema higiênico e seguro para secagem das mãos?$q$, 2, 14, false),
  ($q$Boas Práticas$q$, $q$Edificação e Instalações$q$, $q$Coletores dos resíduos dos banheiros dotados de tampa e acionados sem contato manual?$q$, 2, 15, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Existência de pias exclusivas para a higiene das mãos na área de manipulação, em posições estratégicas em relação ao fluxo de preparo dos alimentos e em número suficiente de modo a atender toda a área de preparação?$q$, 1, 16, false),
  ($q$Boas Práticas$q$, $q$Edificação e Instalações$q$, $q$Pias dotadas de sabonete líquido inodoro antisséptico ou sabonete líquido inodoro + produto antisséptico, toalhas de papel não reciclado ou outro sistema higiênico e seguro de secagem das mãos e coletor de papel, acionados sem contato manual?$q$, 2, 17, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Iluminação adequada e sem sombras?$q$, 1, 18, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Luminárias localizadas sobre as áreas de preparação ou distribuição dos alimentos estão protegidas contra explosão e quedas acidentais?$q$, 1, 19, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Instalações elétricas embutidas ou protegidas em tubulações externas e íntegras de tal forma a permitir a higienização dos ambientes?$q$, 1, 20, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$A ventilação garante a renovação do ar e a manutenção do ambiente, livre de fungos, gases, fumaça, pós, partículas em suspensão, condensação de vapores dentre outros que possam comprometer a qualidade higiênico-sanitária do alimento?$q$, 1, 21, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Não evidenciada a presença de ventiladores nas áreas de manipulação de alimentos?$q$, 1, 22, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Equipamentos e filtros para climatização conservados?$q$, 1, 23, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Ralos sifonados e grelhas com dispositivo que permitam seu fechamento?$q$, 1, 24, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Caixas de gordura e esgoto localizadas fora da área de preparação ou armazenamento de alimentos, em adequado estado de conservação e funcionamento?$q$, 1, 25, false),
  ($q$Estrutura$q$, $q$Edificação e Instalações$q$, $q$Edificação e instalações projetadas de forma a possibilitar um fluxo ordenado e sem cruzamentos em todas as etapas da preparação de alimentos facilitando as operações de manutenção e limpeza?$q$, 1, 26, false),
  ($q$Boas Práticas$q$, $q$Recebimento e Armazenamento$q$, $q$Possuem procedimento especificando os critérios para avaliação e seleção de fornecedores de matérias-primas, ingredientes e embalagens?$q$, 2, 27, false),
  ($q$Boas Práticas$q$, $q$Recebimento e Armazenamento$q$, $q$O recebimento de mercadorias é realizada em área protegida e limpa?$q$, 2, 28, false),
  ($q$Boas Práticas$q$, $q$Recebimento e Armazenamento$q$, $q$Durante o recebimento é realizada a verificação de temperatura, condições da embalagem, rotulagem (RDC 429 e IN 75 de 2020), condições do produto e estas informações são registradas?$q$, 2, 29, false),
  ($q$Boas Práticas$q$, $q$Recebimento e Armazenamento$q$, $q$Na área de recebimento possuem paletes para apoio adequado das mercadorias?$q$, 2, 30, false),
  ($q$Boas Práticas$q$, $q$Recebimento e Armazenamento$q$, $q$Os produtos estão armazenados em local limpo e organizado?$q$, 2, 31, false),
  ($q$Boas Práticas$q$, $q$Recebimento e Armazenamento$q$, $q$Os produtos armazenados encontram-se dentro do prazo de validade?$q$, 2, 32, false),
  ($q$Boas Práticas$q$, $q$Recebimento e Armazenamento$q$, $q$Sistema PVPS encontra-se implantado?$q$, 2, 33, false),
  ($q$Boas Práticas$q$, $q$Recebimento e Armazenamento$q$, $q$Nos estoques, os produtos estão armazenados sobre paletes, estrados e/ou prateleiras de material liso, resistente, impermeável e lavável, respeitando o espaçamento mínimo necessário para garantir adequada ventilação, limpeza e, quando for o caso, desinfecção do local?$q$, 2, 34, false),
  ($q$Boas Práticas$q$, $q$Recebimento e Armazenamento$q$, $q$Todos os produtos armazenados (matéria prima, fracionados, processados ou acabados) encontram-se devidamente etiquetados?$q$, 2, 35, false),
  ($q$Boas Práticas$q$, $q$Recebimento e Armazenamento$q$, $q$Antes de serem enviados à cozinha, os produtos são retirados das caixas de papelão?$q$, 2, 36, false),
  ($q$Boas Práticas$q$, $q$Recebimento e Armazenamento$q$, $q$As câmaras e outros equipamentos de refrigeração encontram-se organizados?$q$, 2, 37, false),
  ($q$Boas Práticas$q$, $q$Higienização$q$, $q$Higienização das instalações é adequada e realizada com frequência?$q$, 2, 38, false),
  ($q$Boas Práticas$q$, $q$Higienização$q$, $q$Existe registro das operações de limpeza realizadas não rotineiramente?$q$, 2, 39, false),
  ($q$Boas Práticas$q$, $q$Higienização$q$, $q$Produtos saneantes utilizados, são regularizados no Ministério da Saúde? As fichas técnicas e as fichas de segurança dos produtos estão disponíveis?$q$, 2, 40, false),
  ($q$Boas Práticas$q$, $q$Higienização$q$, $q$Diluição e tempo de contato e modo de uso/aplicação dos produtos saneantes obedecem às instruções recomendadas pelo fabricante?$q$, 2, 41, false),
  ($q$Boas Práticas$q$, $q$Higienização$q$, $q$Produtos de higienização são guardados em local reservado para essa finalidade?$q$, 2, 42, false),
  ($q$Boas Práticas$q$, $q$Higienização$q$, $q$Equipamentos e utensílios se encontram higienizados?$q$, 2, 43, false),
  ($q$Boas Práticas$q$, $q$Higienização$q$, $q$Luminárias, interruptores e tomadas se encontram higienizados?$q$, 2, 44, false),
  ($q$Boas Práticas$q$, $q$Higienização$q$, $q$Pisos são mantidos secos e sem resíduos de produção ou outros detritos?$q$, 2, 45, false),
  ($q$Boas Práticas$q$, $q$Higienização$q$, $q$Paredes, azulejos, divisórias e portas se encontram higienizados?$q$, 2, 46, false),
  ($q$Boas Práticas$q$, $q$Higienização$q$, $q$Ralos sem resíduos e higienizados?$q$, 2, 47, false),
  ($q$Estrutura$q$, $q$Higienização$q$, $q$Telas íntegras e higienizadas?$q$, 1, 48, false),
  ($q$Estrutura$q$, $q$Higienização$q$, $q$Tetos higienizados?$q$, 1, 49, false),
  ($q$Estrutura$q$, $q$Higienização$q$, $q$Existe evidência da limpeza dos equipamentos do sistema de climatização, troca de filtros e manutenção periódica?$q$, 1, 50, false),
  ($q$Boas Práticas$q$, $q$Higienização$q$, $q$Utilizam panos descartáveis e seu descarte é adequado?$q$, 2, 51, false),
  ($q$Boas Práticas$q$, $q$Higienização$q$, $q$Caixas de gordura são periodicamente limpas? Quando foi realizada a última limpeza?$q$, 2, 52, false),
  ($q$Estrutura$q$, $q$Equipamentos e Utensílios$q$, $q$Equipamentos em perfeito estado de conservação e isentos de improvisações?$q$, 1, 53, false),
  ($q$Boas Práticas$q$, $q$Equipamentos e Utensílios$q$, $q$Utensílios adequados, constituídos de material atóxico, ausente de frestas, não permitindo o acúmulo de sujidades?$q$, 2, 54, false),
  ($q$Estrutura$q$, $q$Equipamentos e Utensílios$q$, $q$É realizada manutenção programada e periódica dos equipamentos e utensílios?$q$, 1, 55, false),
  ($q$Boas Práticas$q$, $q$Equipamentos e Utensílios$q$, $q$Termômetros são calibrados e possuem registros da realização dessas operações?$q$, 2, 56, false),
  ($q$Estrutura$q$, $q$Equipamentos e Utensílios$q$, $q$Lixeiras providas de tampas acionadas por pedais e em bom estado de funcionamento e conservação?$q$, 1, 57, false),
  ($q$Estrutura$q$, $q$Equipamentos e Utensílios$q$, $q$As câmaras e outros equipamentos de refrigeração estão em bom estado de conservação?$q$, 1, 58, false),
  ($q$Estrutura$q$, $q$Equipamentos e Utensílios$q$, $q$Lixeiras externas com capacidade adequada e encontram-se fechadas?$q$, 1, 59, false),
  ($q$Boas Práticas$q$, $q$Equipamentos e Utensílios$q$, $q$Durante a produção, é feita a retirada frequente dos resíduos da área de processamento, evitando focos de contaminação?$q$, 2, 60, false),
  ($q$Estrutura$q$, $q$Equipamentos e Utensílios$q$, $q$A área onde se encontra o gás (GLP) é exclusiva, provida de grades e com boa ventilação?$q$, 1, 61, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$As áreas são divididas de acordo com a atividade desenvolvida e encontram-se organizadas?$q$, 2, 62, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$Evita-se o contato direto ou indireto entre alimentos crus, semipreparados e prontos para o consumo?$q$, 2, 63, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$O fluxo do pré-preparo evita o cruzamento entre alimentos crus, higienizados e prontos para consumo? (Observação do fluxo e fotografia da área)$q$, 2, 64, true),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$Carnes, hortifrúti e alimentos prontos são manipulados em áreas, bancadas ou horários separados? (Acompanhamento da operação e fotografia as áreas)$q$, 2, 65, true),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$As bancadas são higienizadas entre diferentes atividades e tipos de alimentos? (Observação da troca de processo e fotografia do processo)$q$, 2, 66, true),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$Utensílios e equipamentos são higienizados entre o uso com alimentos crus e prontos? (Placas de corte, facas, cubas, processadores e fatiadores)$q$, 2, 67, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$As placas de corte e os utensílios são diferenciados por tipo de alimento ou possuem outro controle eficaz? Código de cores, identificação ou procedimento (Observar e fotografar)$q$, 2, 68, true),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$Não há contato de caixas externas, embalagens de transporte ou objetos pessoais com bancadas limpas?$q$, 2, 69, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$O processo de descongelamento ocorre de modo seguro, em temperatura inferior a 5°C, evitando a contaminação dos produtos? Os produtos estão devidamente identificados/ controlados por meio de planilha de descongelamento?$q$, 2, 70, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$As matérias-primas e os ingredientes caracterizados como produtos perecíveis estão expostos à temperatura ambiente somente pelo tempo mínimo necessário para a preparação do alimento, a fim de não comprometer a qualidade higiênico-sanitária do alimento preparado (no máximo 30 minutos)?$q$, 2, 71, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$Após o pré-preparo, os alimentos são protegidos, identificados e armazenados imediatamente?$q$, 2, 72, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$Após a abertura ou retirada da embalagem original as matérias-primas e os ingredientes que não forem utilizados em sua totalidade, são adequadamente acondicionados e identificados com, no mínimo, as seguintes informações: designação do produto, data de fracionamento e novo prazo de validade; para produtos transferidos da embalagem original considerar também a inclusão de lote, marca e, para itens de origem animal, SIF?$q$, 2, 73, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$Os FLV são selecionados antes da higienização, com retirada de partes deterioradas, sujidades e corpos estranhos? A lavagem inicial é realizada individualmente ou folha a folha, em água corrente potável?$q$, 2, 74, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$O produto utilizado é regularizado e indicado especificamente para higienização de alimentos?$q$, 2, 75, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$A diluição é realizada conforme o rótulo ou procedimento aprovado pela unidade? São utilizados medidores padronizados para preparar a solução?$q$, 2, 76, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$A concentração da solução é monitorada, quando aplicável? O tempo de contato é controlado conforme orientação do fabricante?$q$, 2, 77, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$O enxágue é realizado quando indicado pelo fabricante, utilizando água corrente potável?$q$, 2, 78, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$Existe controle ou registro da higienização dos FLV?$q$, 2, 79, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$Após a sanitização, os FLV são manipulados somente com mãos e utensílios devidamente higienizados? Após a higienização, os FLV são mantidos protegidos, identificados e sob refrigeração até o momento da utilização?$q$, 2, 80, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$O tratamento térmico dos alimentos durante a cocção, garante que todas as partes dos alimento atinja, no mínimo, 75°C? Este controle é realizado em todos os horários (almoço, jantar e ceia)? Existe registro desta operação?$q$, 2, 81, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$Os alimentos cozidos e servidos frios, possuem suas temperaturas reduzidas de 60°C a 10°C, em até 2 horas? Este controle é realizado em todos os serviços (almoço, jantar e ceia)? Existe registro desta operação?$q$, 2, 82, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$Após serem submetidos à cocção, os alimentos preparados são mantidos à temperatura superior a 60ºC, por, no máximo, 6 horas? Este controle é realizado em todos os serviços (almoço, jantar e ceia)? Existe registro desta operação?$q$, 2, 83, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$As câmaras e outros equipamentos de refrigeração, como geladeiras e freezers, possuem suas temperaturas regularmente monitorada e registrada?$q$, 2, 84, false),
  ($q$Estrutura$q$, $q$Processo$q$, $q$A área do serviço de alimentação onde se realiza a atividade de recebimento de dinheiro, cartões e outros meios utilizados para o pagamento de despesas, é reservada?$q$, 1, 85, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$Os funcionários responsáveis por essa atividade não manipulam alimentos preparados, embalados ou não?$q$, 2, 86, false),
  ($q$Boas Práticas$q$, $q$Processo$q$, $q$As embalagens de produtos não são reutilizadas na produção ou na limpeza?$q$, 2, 87, false),
  ($q$Boas Práticas$q$, $q$Manipuladores$q$, $q$A uniformização está adequada e em bom estado de conservação?$q$, 2, 88, false),
  ($q$Boas Práticas$q$, $q$Manipuladores$q$, $q$Manipuladores com mãos limpas, unhas curtas, sem esmalte ou base, sem adornos (anéis, pulseiras, brincos, celulares, etc.), barba e maquiagem?$q$, 2, 89, false),
  ($q$Boas Práticas$q$, $q$Manipuladores$q$, $q$Manipuladores com cabelos presos e protegidos por redes ou toucas?$q$, 2, 90, false),
  ($q$Boas Práticas$q$, $q$Manipuladores$q$, $q$Cumpre-se as determinações de fumar ou comer apenas nos locais específicos?$q$, 2, 91, false),
  ($q$Boas Práticas$q$, $q$Manipuladores$q$, $q$Os colaboradores higienizam as mãos antes de iniciar a atividade e nas trocas de processo?$q$, 2, 92, false),
  ($q$Boas Práticas$q$, $q$Manipuladores$q$, $q$Há troca adequada de luvas entre atividades, sem substituição da lavagem das mãos?$q$, 2, 93, false),
  ($q$Boas Práticas$q$, $q$Manipuladores$q$, $q$Possuem cartazes de orientação aos manipuladores sobre a correta lavagem das mãos, afixados em locais de fácil visualização, inclusive nas instalações sanitárias e lavatórios?$q$, 2, 94, false),
  ($q$Boas Práticas$q$, $q$Manipuladores$q$, $q$Os funcionários utilizam EPI's, quando necessário?$q$, 2, 95, false),
  ($q$Boas Práticas$q$, $q$Manipuladores$q$, $q$Os atestados de saúde ocupacional se encontram atualizados conforme descrito no PCMSO?$q$, 2, 96, false),
  ($q$Boas Práticas$q$, $q$Manipuladores$q$, $q$Existe registro de treinamento periódico em Boas Práticas na Manipulação de Alimentos?$q$, 2, 97, false),
  ($q$Boas Práticas$q$, $q$Manipuladores$q$, $q$Possuem uniformes para visitantes (jaleco e touca descartável)?$q$, 2, 98, false),
  ($q$Boas Práticas$q$, $q$Manipuladores$q$, $q$PGR e PCMSO dentro do prazo de vigência e atualizados conforme as características da Unidade?$q$, 2, 99, false),
  ($q$Boas Práticas$q$, $q$Controle de Qualidade$q$, $q$Existe um responsável pelas atividades de manipulação dos alimentos, devidamente capacitado? Existe documento comprobatório (CMVS ou Licença Sanitária)?$q$, 2, 100, false),
  ($q$Boas Práticas$q$, $q$Controle de Qualidade$q$, $q$O Manual de Boas Práticas e de Procedimentos Operacionais Padronizados, encontram-se adaptados as condições do estabelecimento, devidamente atualizado e implantado?$q$, 2, 101, false),
  ($q$Boas Práticas$q$, $q$Controle de Qualidade$q$, $q$As amostras dos alimentos e bebidas servidos são coletados diariamente e em todos os serviços? Foram coletadas em quantidade adequada (Mínimo de 100g conforme preconiza a legislação sanitária vigente)?$q$, 2, 102, false),
  ($q$Boas Práticas$q$, $q$Controle de Qualidade$q$, $q$As amostras estão armazenadas de forma organizada e conforme preconiza a legislação sanitária vigente?$q$, 2, 103, false),
  ($q$Boas Práticas$q$, $q$Controle de Qualidade$q$, $q$Realizam análises microbiológicas periódicas em alimentos, conforme RDC 724 e IN 161? Qual a periodicidade das análises?$q$, 2, 104, false),
  ($q$Boas Práticas$q$, $q$Controle de Qualidade$q$, $q$Os registros são mantidos por período mínimo de 30 dias, contados a partir da preparação dos alimentos?$q$, 2, 105, false),
  ($q$Boas Práticas$q$, $q$Controle de Qualidade$q$, $q$Possuem registros de controle para monitoramento de sobra?$q$, 2, 106, false),
  ($q$Boas Práticas$q$, $q$Controle de Qualidade$q$, $q$Possuem registros de controle para monitoramento de resto?$q$, 2, 107, false),
  ($q$Boas Práticas$q$, $q$Controle Integrado de Pragas$q$, $q$Ausência de vetores e pragas urbanas ou qualquer evidência de sua presença como fezes, ninhos e outros?$q$, 2, 108, false),
  ($q$Boas Práticas$q$, $q$Controle Integrado de Pragas$q$, $q$Existe programa de desratização e desinsetização?$q$, 2, 109, false),
  ($q$Boas Práticas$q$, $q$Controle Integrado de Pragas$q$, $q$A empresa contratada para o Controle de Pragas possui licença sanitária atualizada?$q$, 2, 110, false),
  ($q$Boas Práticas$q$, $q$Controle Integrado de Pragas$q$, $q$Armazenagem de venenos é feita em locais específicos e distantes de produtos alimentícios?$q$, 2, 111, false),
  ($q$Boas Práticas$q$, $q$Controle Integrado de Pragas$q$, $q$Possuem registros para monitoramento da presença de pragas?$q$, 2, 112, false),
  ($q$Boas Práticas$q$, $q$Controle Integrado de Pragas$q$, $q$Existe um mapeamento indicando a localização das iscas para roedores?$q$, 2, 113, false),
  ($q$Boas Práticas$q$, $q$Abastecimento de Água$q$, $q$São realizadas análises periódicas da água, para comprovação de sua potabilidade?$q$, 2, 114, false),
  ($q$Boas Práticas$q$, $q$Abastecimento de Água$q$, $q$Reservatório de água higienizado adequadamente e realizada a cada 6 meses?$q$, 2, 115, false),
  ($q$Boas Práticas$q$, $q$Distribuição$q$, $q$Os salões de distribuição encontram-se organizados e em adequadas condições higiênico-sanitárias?$q$, 2, 116, false),
  ($q$Boas Práticas$q$, $q$Distribuição$q$, $q$Utensílios utilizados na área de consumo do alimento, tais como pratos, copos e talheres, quando feitos de material não descartável, encontram-se devidamente higienizados e armazenados em local protegido?$q$, 2, 117, false),
  ($q$Boas Práticas$q$, $q$Distribuição$q$, $q$Os balcões de distribuição de alimentos (frios e quentes) preparados se encontram em adequado estado de higiene, conservação e funcionamento?$q$, 2, 118, false),
  ($q$Boas Práticas$q$, $q$Distribuição$q$, $q$Temperatura desses equipamentos (balcões de distribuição frios e quentes) é regularmente monitorada e registrada? Este controle é realizado em todos os horários (desjejum, almoço, jantar e ceia)?$q$, 2, 119, false),
  ($q$Boas Práticas$q$, $q$Distribuição$q$, $q$As reposições de preparações são realizadas sempre que necessário?$q$, 2, 120, false),
  ($q$Boas Práticas$q$, $q$Distribuição$q$, $q$A temperatura dos alimentos em distribuição é monitorada e registrada? Este controle é realizado em todos os horários (desjejum, almoço, jantar e ceia)?$q$, 2, 121, false),
  ($q$Boas Práticas$q$, $q$Distribuição$q$, $q$Produtos que aguardam a distribuição encontram-se armazenados em temperatura adequada?$q$, 2, 122, false),
  ($q$Boas Práticas$q$, $q$Distribuição$q$, $q$Temperaturas dos passthroughs (quentes e frios) são regularmente monitoradas e registradas? Este controle é realizado em todos os horários (almoço, jantar e ceia)?$q$, 2, 123, false),
  ($q$Boas Práticas$q$, $q$Distribuição$q$, $q$Sobras de preparações são desprezadas e não são reutilizadas no próximo turno?$q$, 2, 124, false),
  ($q$Boas Práticas$q$, $q$Distribuição$q$, $q$Ornamentos e plantas localizados na área de consumo ou refeitório não constituem fonte de contaminação para os alimentos preparados?$q$, 2, 125, false),
  ($q$Boas Práticas$q$, $q$Distribuição$q$, $q$Não evidenciada a presença de pragas no salão de distribuição?$q$, 2, 126, false)
    ) AS v(grupo, secao, texto, peso, ordem, foto);
END$$;

NOTIFY pgrst, 'reload schema';

-- Conferência: 126 perguntas (Estrutura 30, Boas Práticas 96) e 4 com foto obrigatória
SELECT count(*) AS perguntas,
       count(*) FILTER (WHERE grupo = 'Estrutura') AS estrutura,
       count(*) FILTER (WHERE grupo = 'Boas Práticas') AS boas_praticas,
       count(*) FILTER (WHERE foto_obrigatoria) AS com_foto_obrigatoria
  FROM auditoria_perguntas WHERE modelo_id = '7e1e0000-0000-4000-8000-000000000001' AND ativo;
