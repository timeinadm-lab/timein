-- ============================================================
-- Migration 038 — Foto no perfil do usuário do RH
-- ------------------------------------------------------------
-- user_profiles só tinha nome/e-mail/papel. Agora cada pessoa do RH
-- pode ter foto e editar o próprio nome em "Meu Perfil".
-- A foto guarda só o CAMINHO no storage (bucket "fotos de funcionários",
-- mesmo padrão de employees.photo_url) — a exibição usa URL assinada.
-- ============================================================

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS photo_url TEXT;

NOTIFY pgrst, 'reload schema';
