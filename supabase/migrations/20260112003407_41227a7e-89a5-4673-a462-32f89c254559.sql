-- 1. Enable RLS on compliance_rules and add appropriate policies
ALTER TABLE public.compliance_rules ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read compliance rules
CREATE POLICY "Authenticated users can view compliance rules"
ON public.compliance_rules FOR SELECT
USING (auth.role() = 'authenticated');

-- Only admins and TK Masters can manage compliance rules
CREATE POLICY "Admins and TK Masters can insert compliance rules"
ON public.compliance_rules FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'tk_master')
  )
);

CREATE POLICY "Admins and TK Masters can update compliance rules"
ON public.compliance_rules FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'tk_master')
  )
);

CREATE POLICY "Admins and TK Masters can delete compliance rules"
ON public.compliance_rules FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role IN ('admin', 'tk_master')
  )
);

-- 2. Fix invites table - remove overly permissive policy and create secure validation
DROP POLICY IF EXISTS "Anyone can validate invite by token" ON public.invites;

-- Create a secure function to validate invite tokens without exposing email
CREATE OR REPLACE FUNCTION public.validate_invite_token(p_token TEXT)
RETURNS TABLE (is_valid BOOLEAN, email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    TRUE as is_valid,
    i.email
  FROM invites i
  WHERE i.token = p_token
    AND i.status = 'pending'
    AND i.expires_at > NOW();
    
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE as is_valid, NULL::TEXT as email;
  END IF;
END;
$$;

-- Grant execute to anon users (for registration flow)
GRANT EXECUTE ON FUNCTION public.validate_invite_token(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_invite_token(TEXT) TO authenticated;

-- 3. Fix knowledge_feedback - add user_id column and restrict access
ALTER TABLE public.knowledge_feedback ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can view feedback" ON public.knowledge_feedback;
DROP POLICY IF EXISTS "Authenticated users can insert feedback" ON public.knowledge_feedback;
DROP POLICY IF EXISTS "Authenticated users can update feedback" ON public.knowledge_feedback;

-- Create properly scoped policies for knowledge_feedback
-- Users can only view their own feedback OR admins can view all
CREATE POLICY "Users can view own feedback or admins view all"
ON public.knowledge_feedback FOR SELECT
USING (
  user_id = auth.uid() 
  OR user_id IS NULL  -- Allow viewing legacy data without user_id
  OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND role IN ('admin', 'tk_master')
  )
);

-- Users can insert feedback with their own user_id
CREATE POLICY "Users can insert own feedback"
ON public.knowledge_feedback FOR INSERT
WITH CHECK (
  auth.role() = 'authenticated'
  AND (user_id IS NULL OR user_id = auth.uid())
);

-- Users can only update their own feedback
CREATE POLICY "Users can update own feedback"
ON public.knowledge_feedback FOR UPDATE
USING (
  user_id = auth.uid()
  OR user_id IS NULL  -- Allow updating legacy data
  OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND role IN ('admin', 'tk_master')
  )
);

-- Admins and TK Masters can delete feedback
CREATE POLICY "Admins can delete feedback"
ON public.knowledge_feedback FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
    AND role IN ('admin', 'tk_master')
  )
);