-- ============================================================
-- Migration 039 — Destrava contratos presos em "Em contrato"
-- ------------------------------------------------------------
-- Anexar o contrato pela aba Vínculos do colaborador gravava o arquivo
-- no vínculo e em Documentos, mas nunca fechava o vacancy_interests.
-- Só o botão "Contratar" da tela da Vaga fazia isso. Resultado: quem teve
-- o contrato anexado pela ficha ficou marcado como "não devolveu o
-- contrato assinado" pra sempre — alarme falso no painel.
--
-- O código já foi corrigido. Isto limpa quem ficou preso.
-- ============================================================

-- Fecha o interesse de quem JÁ é colaborador e JÁ tem o contrato anexado
UPDATE vacancy_interests vi
SET status = 'Contratado',
    hired_at = COALESCE(vi.hired_at, NOW()),
    employee_id = COALESCE(vi.employee_id, ecl.employee_id)
FROM employee_client_links ecl
JOIN employees e ON e.id = ecl.employee_id
WHERE vi.status = 'Em contrato'
  AND ecl.contract_file_url IS NOT NULL
  AND (
    vi.employee_id = ecl.employee_id
    OR ecl.vacancy_id = vi.vacancy_id
    OR EXISTS (
      SELECT 1 FROM candidates c
      WHERE c.id = vi.candidate_id
        AND lower(trim(c.full_name)) = lower(trim(e.full_name))
    )
  );

-- Conferência: o que AINDA está pendente de assinatura de verdade
SELECT
  c.full_name        AS candidato,
  v.title            AS vaga,
  vi.deadline::date  AS prazo,
  CASE WHEN vi.deadline < NOW() THEN 'VENCIDO' ELSE 'no prazo' END AS situacao
FROM vacancy_interests vi
LEFT JOIN candidates c ON c.id = vi.candidate_id
LEFT JOIN vacancies  v ON v.id = vi.vacancy_id
WHERE vi.status = 'Em contrato'
ORDER BY vi.deadline;
