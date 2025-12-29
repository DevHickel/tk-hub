-- Add DELETE policy for invites table so admins can delete invites
CREATE POLICY "Admins can delete invites"
ON public.invites
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'tk_master'::app_role));