-- ============================================================
-- Migration 046 — Redefinir senha destrava o acesso + diagnóstico
-- ------------------------------------------------------------
-- POR QUE
-- A 045 restaurou o bloqueio por tentativas (5 erros = 15 minutos travado).
-- Só que o RH não tinha NENHUMA forma de destravar: a tabela
-- portal_login_attempts é revogada de anon e não aparece em tela nenhuma.
-- Resultado: a pessoa erra 5 vezes, o RH troca a senha dela, e ela CONTINUA
-- sem entrar por 15 minutos — sem ninguém entender por quê.
--
-- Agora trocar a senha zera as tentativas: é o gesto natural de "libera essa
-- pessoa", e quem troca a senha é o RH logado, não um estranho.
-- ============================================================

CREATE OR REPLACE FUNCTION portal_set_pin(p_employee uuid, p_pin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cpf text;
BEGIN
  IF auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'Apenas usuários internos podem definir a senha' USING ERRCODE='42501';
  END IF;

  UPDATE employees
     SET portal_pin_hash = crypt(p_pin, gen_salt('bf')),
         portal_pin      = NULL          -- nunca guarda a senha em texto
   WHERE id = p_employee
  RETURNING regexp_replace(coalesce(cpf,''), '\D', '', 'g') INTO v_cpf;

  -- Destrava: senha nova zera o contador de tentativas erradas
  IF v_cpf IS NOT NULL AND v_cpf <> '' THEN
    DELETE FROM portal_login_attempts WHERE cpf_digits = v_cpf;
  END IF;
END$$;

GRANT EXECUTE ON FUNCTION portal_set_pin(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION portal_set_pin(uuid, text) FROM anon, public;

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- DIAGNÓSTICO — rode e me mande o resultado
-- ============================================================

-- 1) A extensão de senha existe? (crypt depende dela)
SELECT 'pgcrypto instalado' AS item,
       EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') AS ok;

-- 2) Quem está TRAVADO por tentativas agora
SELECT e.full_name, a.cpf_digits, a.fails, a.locked_until,
       (a.locked_until > now()) AS travado_agora
FROM portal_login_attempts a
LEFT JOIN employees e
  ON regexp_replace(coalesce(e.cpf,''), '\D', '', 'g') = a.cpf_digits
ORDER BY a.locked_until DESC NULLS LAST;

-- 3) A trava de contrato está barrando alguém?
SELECT e.full_name, c.name AS cliente
FROM employee_client_links ecl
JOIN employees e ON e.id = ecl.employee_id
JOIN clients   c ON c.id = ecl.client_id
WHERE ecl.contract_required = TRUE
  AND ecl.contract_file_url IS NULL
  AND (ecl.contract_end_date IS NULL OR ecl.contract_end_date >= CURRENT_DATE)
  AND e.status = 'Ativo'
ORDER BY e.full_name;
