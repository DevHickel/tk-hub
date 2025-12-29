-- Add status column to bug_reports
ALTER TABLE public.bug_reports 
ADD COLUMN status text NOT NULL DEFAULT 'pending';

-- Add RLS policy for admins to update bug reports
CREATE POLICY "Admins can update bug reports" 
ON public.bug_reports 
FOR UPDATE 
USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'tk_master'::app_role)
);

-- Add RLS policy for admins to delete bug reports
CREATE POLICY "Admins can delete bug reports" 
ON public.bug_reports 
FOR DELETE 
USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'tk_master'::app_role)
);