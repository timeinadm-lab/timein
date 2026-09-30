-- ============================================================
-- Migration 069 — CPF só com números + a nutri troca a própria senha
-- ------------------------------------------------------------
-- Pedido do Gabriel (30/09/2026).
--
-- 1. CPF: tira ponto, traço e espaço de todos os cadastros de colaborador
--    e, daqui pra frente, grava sempre só os números (gatilho).
--    O login JÁ comparava só os números dos dois lados, então quem entra hoje
--    continua entrando igual — com ou sem ponto, antes ou depois.
--    CPF sem nenhum número (ex.: "pendente") fica como está.
--
-- 2. portal_trocar_senha: no portal, a nutricionista troca a senha dela
--    informando a atual. A nova vira senha própria (como a que o RH define na
--    ficha). O RH continua podendo trocar ou voltar para a padrão.
--
-- Não mexe em senha de ninguém ao rodar. Pode rodar mais de uma vez.
-- ============================================================


-- ── 1. CPF só com números ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cpf_so_numeros()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cpf IS NOT NULL AND NEW.cpf ~ '[0-9]' THEN
    NEW.cpf := regexp_replace(NEW.cpf, '[^0-9]', '', 'g');
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_cpf_so_numeros ON employees;
CREATE TRIGGER trg_cpf_so_numeros BEFORE INSERT OR UPDATE OF cpf ON employees
  FOR EACH ROW EXECUTE FUNCTION cpf_so_numeros();

UPDATE employees
   SET cpf = regexp_replace(cpf, '[^0-9]', '', 'g')
 WHERE cpf ~ '[0-9]' AND cpf ~ '[^0-9]';


-- ── 2. A nutricionista troca a própria senha ─────────────────────────────
CREATE OR REPLACE FUNCTION portal_trocar_senha(p_token text, p_atual text, p_nova text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_uid  uuid := portal_uid(p_token);
  v_hash text;
  v_nova text := btrim(coalesce(p_nova, ''));
BEGIN
  -- Senha atual: a própria; se não tiver, a padrão (mesma regra do login)
  SELECT pin_hash INTO v_hash FROM app_private.portal_credentials WHERE employee_id = v_uid;
  IF v_hash IS NULL THEN
    SELECT default_pin_hash INTO v_hash FROM app_private.portal_config WHERE id;
  END IF;
  IF v_hash IS NULL OR crypt(btrim(coalesce(p_atual, '')), v_hash) <> v_hash THEN
    -- Sem o código 28000: no portal ele significa "sessão acabou" e a tiraria do portal
    RAISE EXCEPTION 'A senha atual não confere';
  END IF;

  IF octet_length(v_nova) NOT BETWEEN 6 AND 72 THEN
    RAISE EXCEPTION 'A nova senha precisa ter pelo menos 6 caracteres';
  END IF;
  IF crypt(v_nova, v_hash) = v_hash THEN
    RAISE EXCEPTION 'A nova senha é igual à atual';
  END IF;

  INSERT INTO app_private.portal_credentials (employee_id, pin_hash, updated_at)
  VALUES (v_uid, crypt(v_nova, gen_salt('bf', 12)), now())
  ON CONFLICT (employee_id) DO UPDATE
    SET pin_hash   = EXCLUDED.pin_hash,
        updated_at = EXCLUDED.updated_at;
  -- A sessão atual continua valendo: ela não é jogada para fora do portal
END$$;

GRANT EXECUTE ON FUNCTION portal_trocar_senha(text, text, text) TO anon;

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- CONFERÊNCIA — deve mostrar 0 na primeira linha.
-- As linhas seguintes (se houver) são CPFs de pessoas ativas que não têm
-- 11 números — provavelmente digitados errado no cadastro. Não quebra nada:
-- vale conferir na ficha antes do treinamento, porque a pessoa vai digitar o
-- CPF certo e o sistema não vai reconhecer.
-- ============================================================
SELECT 'CPFs ainda com ponto/traço' AS item, count(*)::text AS valor
  FROM employees WHERE cpf ~ '[0-9]' AND cpf ~ '[^0-9]'
UNION ALL
SELECT 'CPF com tamanho errado: ' || full_name, coalesce(cpf, '')
  FROM employees
 WHERE status = 'Ativo' AND cpf ~ '[0-9]' AND length(cpf) <> 11;
