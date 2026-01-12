-- Inserir perfil para usuário existente que não tem perfil
INSERT INTO public.profiles (id, email, full_name)
SELECT id, email, raw_user_meta_data->>'full_name'
FROM auth.users
WHERE id = 'a676f88c-0b68-43e9-82bf-2127d8176955'
ON CONFLICT (id) DO NOTHING;