-- ============================================================
-- AUDITORIA (só leitura — não apaga nada). 14/10/2026.
-- Ajuda de custo de quem não tem vínculo valendo naquela semana.
-- Coluna "situacao":
--   PENDENTE SOBRANDO  → semana depois do fim do vínculo, ainda "a pagar"
--   PAGO DEPOIS DO FIM → foi pago por semana em que ela já não estava (conferir!)
--   PAGO ANTES DO FIM  → normal: histórico de quando ela trabalhava
-- Rodar depois da 092 (usa a função ultimo_dia_do_vinculo).
-- ============================================================
SELECT
  e.full_name                                   AS pessoa,
  e.status                                      AS status_pessoa,
  c.name                                        AS cliente,
  a.tipo, a.descricao,
  to_char(a.inicio, 'DD/MM') || ' a ' || to_char(a.fim, 'DD/MM') AS semana,
  a.valor, a.status,
  to_char(a.pago_em, 'DD/MM/YYYY')              AS pago_em,
  CASE WHEN ultimo_dia_do_vinculo(a.employee_id, a.client_id) = '-infinity' THEN 'sem vínculo'
       ELSE to_char(ultimo_dia_do_vinculo(a.employee_id, a.client_id), 'DD/MM/YYYY') END AS ultimo_dia_vinculo,
  CASE
    WHEN a.status = 'Pendente' THEN 'PENDENTE SOBRANDO'
    WHEN a.inicio > coalesce(ultimo_dia_do_vinculo(a.employee_id, a.client_id), 'infinity'::date) THEN 'PAGO DEPOIS DO FIM'
    ELSE 'PAGO ANTES DO FIM'
  END                                           AS situacao,
  a.id
FROM ajudas_custo a
JOIN employees e ON e.id = a.employee_id
LEFT JOIN clients c ON c.id = a.client_id
WHERE a.expense_id IS NULL
  AND ultimo_dia_do_vinculo(a.employee_id, a.client_id) IS NOT NULL      -- tem fim (ou nenhum vínculo)
  AND (a.inicio > ultimo_dia_do_vinculo(a.employee_id, a.client_id)     -- semana depois do fim
       OR e.status = 'Inativo')
ORDER BY situacao DESC, e.full_name, a.inicio;
