-- Renomear roles: admin → manager, tk_master → admin
-- Novo esquema: user (básico), manager (gerente), admin (acesso total)
--
-- ALTER TYPE RENAME VALUE atualiza automaticamente todos os dados existentes
-- sem precisar de colunas temporárias ou DROP/ADD column.

-- 1. Renomear enum values (ordem importa: admin→manager primeiro para liberar o nome 'admin')
ALTER TYPE public.app_role RENAME VALUE 'admin' TO 'manager';
ALTER TYPE public.app_role RENAME VALUE 'tk_master' TO 'admin';

-- 2. Atualizar profiles.role (legacy) — manager e admin mapeiam para 'admin' no enum user_role
UPDATE public.profiles p
SET role = CASE
  WHEN EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p.id AND ur.role IN ('admin', 'manager')
  ) THEN 'admin'::public.user_role
  ELSE 'user'::public.user_role
END;

-- 3. Atualizar RLS policies que referenciam 'tk_master'

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

-- report_config policies (if table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'report_config') THEN
    DROP POLICY IF EXISTS "report_config_rls" ON public.report_config;
    EXECUTE 'CREATE POLICY "report_config_rls" ON public.report_config
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN (''admin'', ''manager'')))
      WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN (''admin'', ''manager'')))';
  END IF;
END $$;

-- report_recipients policies (if table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'report_recipients') THEN
    DROP POLICY IF EXISTS "report_recipients_rls" ON public.report_recipients;
    EXECUTE 'CREATE POLICY "report_recipients_rls" ON public.report_recipients
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN (''admin'', ''manager'')))
      WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN (''admin'', ''manager'')))';
  END IF;
END $$;

-- weekly_report_log policies (if table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'weekly_report_log') THEN
    DROP POLICY IF EXISTS "weekly_report_log_rls" ON public.weekly_report_log;
    EXECUTE 'CREATE POLICY "weekly_report_log_rls" ON public.weekly_report_log
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN (''admin'', ''manager'')))';
  END IF;
END $$;

-- email_config policies (if table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_config') THEN
    DROP POLICY IF EXISTS "email_config_select" ON public.email_config;
    DROP POLICY IF EXISTS "email_config_modify" ON public.email_config;

    EXECUTE 'CREATE POLICY "email_config_select" ON public.email_config
      FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = ''admin''))';

    EXECUTE 'CREATE POLICY "email_config_modify" ON public.email_config
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = ''admin''))
      WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = ''admin''))';
  END IF;
END $$;

-- certificate_email_accounts policies (if table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'certificate_email_accounts') THEN
    DROP POLICY IF EXISTS "cert_email_select" ON public.certificate_email_accounts;
    DROP POLICY IF EXISTS "cert_email_modify" ON public.certificate_email_accounts;

    EXECUTE 'CREATE POLICY "cert_email_select" ON public.certificate_email_accounts
      FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = ''admin''))';

    EXECUTE 'CREATE POLICY "cert_email_modify" ON public.certificate_email_accounts
      FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = ''admin''))
      WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = ''admin''))';
  END IF;
END $$;

-- 4. Atualizar função has_role
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
