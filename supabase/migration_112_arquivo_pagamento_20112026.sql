-- ============================================================
-- Migration 112 — Primeiro registro do arquivo: 20/11/2026
-- ------------------------------------------------------------
-- Planilha "Dia 20" sem PIX (v9). Cinco pessoas, total R$ 21.609,64.
-- Nomes e observações saíram da planilha. A de Graziele pede confirmação
-- com a Fernanda.
--
-- A coluna da chave PIX fica vazia de propósito: ninguém coloca chave real
-- neste seed. Quem for preencher faz isso no sistema, depois.
-- Não há CPF, agência nem conta.
-- Não mexe em payments nem nas datas de pagamento dos vínculos.
--
-- Rode a 111 antes. Pode rodar mais de uma vez: se o dia 20/11/2026 já
-- tiver linhas, não duplica. NÃO aplicar no banco até o dono aprovar.
-- ============================================================

INSERT INTO arquivo_pagamentos (data_pagamento, observacao)
SELECT DATE '2026-11-20', NULL
 WHERE NOT EXISTS (
   SELECT 1 FROM arquivo_pagamentos WHERE data_pagamento = DATE '2026-11-20'
 );

INSERT INTO arquivo_pagamento_linhas (arquivo_id, ordem, nome, valor, observacao)
SELECT p.id, v.ordem, v.nome, v.valor, v.observacao
  FROM arquivo_pagamentos p
  JOIN (VALUES
    (1, 'Alicia de Paula Monteiro Lima', 900.00::numeric,
        'R$ 900 = 6 visitas de 4h (2 por dia em 04, 05 e 13/11) × R$ 150'),
    (2, 'Ariane Souza Machado', 100.00::numeric,
        'Consultoria Orquidário Oriental · 1 visita (11/11) × R$ 100'),
    (3, 'Helen Cacia Martins de Oliveira', 9000.00::numeric,
        'GRSA HNSN Paraíba · valor cheio'),
    (4, 'Mariana Collaço Soares Dias Marques', 5000.00::numeric,
        'GRSA Hospital Brasil · 12x36 · contrato 19/10 a 17/11'),
    (5, 'Graziele Bassi de Andrade', 6609.64::numeric,
        'SAPORE MELI Embu das Artes · R$ 6.500 + R$ 109,64 reembolso Ubers (11/11) · confirmar com a Fernanda')
  ) AS v(ordem, nome, valor, observacao) ON true
 WHERE p.data_pagamento = DATE '2026-11-20'
   AND NOT EXISTS (
     SELECT 1 FROM arquivo_pagamento_linhas l WHERE l.arquivo_id = p.id
   );

-- Conferência (esperado: 2026-11-20 · 5 pessoas · 21609.64 · com_pix = 0)
SELECT p.data_pagamento, p.quantidade, p.total,
       (SELECT count(*) FROM arquivo_pagamento_linhas l
         WHERE l.arquivo_id = p.id AND l.pix IS NOT NULL) AS com_pix
  FROM arquivo_pagamentos p
 WHERE p.data_pagamento = DATE '2026-11-20';
