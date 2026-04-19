-- Renomear roles: admin → manager, tk_master → admin
-- Novo esquema: user (básico), manager (gerente), admin (acesso total)

-- 1. Adicionar 'manager' ao enum app_role
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';

-- 2. Atualizar dados em user_roles (ordem importa: tk_master→admin primeiro para evitar conflito)
-- Precisamos usar uma coluna temporária porque não dá para fazer swap direto
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS role_new text;

UPDATE public.user_roles SET role_new = CASE
  WHEN role = 'tk_master' THEN 'admin'
  WHEN role = 'admin' THEN 'manager'
  ELSE role::text
END;

-- Dropar a coluna role antiga e recriar com o enum atualizado
ALTER TABLE public.user_roles DROP COLUMN role;
ALTER TABLE public.user_roles ADD COLUMN role public.app_role NOT NULL DEFAULT 'user';
UPDATE public.user_roles SET role = role_new::public.app_role;
ALTER TABLE public.user_roles DROP COLUMN role_new;

-- 3. Atualizar profiles.role (legacy) — manager e admin mapeiam para 'admin' no enum user_role
-- user_role enum só tem 'admin' e 'user', então mantemos compatibilidade
UPDATE public.profiles p
SET role = CASE
  WHEN EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p.id AND ur.role IN ('admin', 'manager')
  ) THEN 'admin'::public.user_role
  ELSE 'user'::public.user_role
END;

-- 4. Atualizar RLS policies que referenciam 'tk_master'

-- invites policies
DROP POLICY IF EXISTS "invites_select_admin" ON public.invites;
DROP POLICY IF EXISTS "invites_insert_admin" ON public.invites;
DROP POLICY IF EXISTS "invites_update_admin" ON public.invites;
DROP POLICY IF EXISTS "invites_delete_admin" ON public.invites;
DROP POLICY IF EXISTS "allow_admin_delete_invites" ON public.invites;

CREATE POLICY "invites_select_admin" ON public.invites
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'manager'))
  );

CREATE POLICY "invites_insert_admin" ON public.invites
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'manager'))
  );

CREATE POLICY "invites_update_admin" ON public.invites
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'manager'))
  );

CREATE POLICY "invites_delete_admin" ON public.invites
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'manager'))
  );

-- bug_reports policies
DROP POLICY IF EXISTS "allow_admin_update_bug_reports" ON public.bug_reports;
DROP POLICY IF EXISTS "allow_admin_delete_bug_reports" ON public.bug_reports;

CREATE POLICY "allow_admin_update_bug_reports" ON public.bug_reports
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'manager'))
  );

CREATE POLICY "allow_admin_delete_bug_reports" ON public.bug_reports
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'manager'))
  );

-- activity_logs policies
DROP POLICY IF EXISTS "allow_admin_delete_activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "allow_admin_update_activity_logs" ON public.activity_logs;

CREATE POLICY "allow_admin_delete_activity_logs" ON public.activity_logs
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- compliance_rules policies (if table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'compliance_rules') THEN
    DROP POLICY IF EXISTS "compliance_rules_insert" ON public.compliance_rules;
    DROP POLICY IF EXISTS "compliance_rules_update" ON public.compliance_rules;
    DROP POLICY IF EXISTS "compliance_rules_delete" ON public.compliance_rules;

    EXECUTE 'CREATE POLICY "compliance_rules_insert" ON public.compliance_rules
      FOR INSERT TO authenticated
      WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN (''admin'', ''manager'')))';

    EXECUTE 'CREATE POLICY "compliance_rules_update" ON public.compliance_rules
      FOR UPDATE TO authenticated
      USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN (''admin'', ''manager'')))';

    EXECUTE 'CREATE POLICY "compliance_rules_delete" ON public.compliance_rules
      FOR DELETE TO authenticated
      USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN (''admin'', ''manager'')))';
  END IF;
END $$;

-- report_config policies
DROP POLICY IF EXISTS "report_config_rls" ON public.report_config;
CREATE POLICY "report_config_rls" ON public.report_config
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'manager')));

-- report_recipients policies
DROP POLICY IF EXISTS "report_recipients_rls" ON public.report_recipients;
CREATE POLICY "report_recipients_rls" ON public.report_recipients
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'manager')));

-- weekly_report_log policies
DROP POLICY IF EXISTS "weekly_report_log_rls" ON public.weekly_report_log;
CREATE POLICY "weekly_report_log_rls" ON public.weekly_report_log
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'manager')));

-- email_config policies
DROP POLICY IF EXISTS "email_config_select" ON public.email_config;
DROP POLICY IF EXISTS "email_config_modify" ON public.email_config;

CREATE POLICY "email_config_select" ON public.email_config
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "email_config_modify" ON public.email_config
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- certificate_email_accounts policies
DROP POLICY IF EXISTS "cert_email_select" ON public.certificate_email_accounts;
DROP POLICY IF EXISTS "cert_email_modify" ON public.certificate_email_accounts;

CREATE POLICY "cert_email_select" ON public.certificate_email_accounts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "cert_email_modify" ON public.certificate_email_accounts
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- 5. Atualizar função has_role para suportar os novos nomes (backward compat)
CREATE OR REPLACE FUNCTION public.has_role(p_user_id uuid, p_role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role = p_role
  );
$$;
