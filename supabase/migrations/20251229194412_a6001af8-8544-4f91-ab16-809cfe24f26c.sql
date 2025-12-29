-- Update the handle_new_user function to also mark invite as accepted
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create user profile
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  
  -- Assign default 'user' role automatically
  INSERT INTO public.user_roles (user_id, role)
  VALUES (new.id, 'user');
  
  -- Mark invite as accepted if exists
  UPDATE public.invites 
  SET status = 'accepted'
  WHERE email = new.email AND status = 'pending';
  
  RETURN new;
END;
$$;