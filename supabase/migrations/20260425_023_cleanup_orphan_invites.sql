-- 1) Cleanup retroativo: marca como 'accepted' qualquer convite pending
-- cujo e-mail já existe em auth.users. Cobre legado de usuários criados
-- antes do trigger handle_new_user, ou via signup direto pelo cliente.
UPDATE public.invites i
SET status = 'accepted'
WHERE i.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM auth.users u
    WHERE lower(u.email) = lower(i.email)
  );

-- 2) RPC SECURITY DEFINER pra o backend checar se um e-mail já existe em
-- auth.users (profiles.email pode estar NULL pra contas legadas, então
-- não confiar só em profiles). Restringe execução ao service_role.
CREATE OR REPLACE FUNCTION public.email_exists_in_auth(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE lower(u.email) = lower(p_email)
  );
$$;

REVOKE ALL ON FUNCTION public.email_exists_in_auth(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.email_exists_in_auth(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_exists_in_auth(text) TO service_role;
