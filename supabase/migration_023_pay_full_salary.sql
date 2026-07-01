-- Adiciona flag "pagar salário inteiro" nos vínculos
-- Quando true, ignora cálculo proporcional (ciclo de pagamento / dias trabalhados)

ALTER TABLE employee_client_links
  ADD COLUMN IF NOT EXISTS pay_full_salary boolean DEFAULT false;
