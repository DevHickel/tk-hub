-- Add RLS policies for knowledge_feedback table to allow authenticated users to manage feedback

-- Allow authenticated users to select feedback
CREATE POLICY "Authenticated users can view feedback"
ON public.knowledge_feedback
FOR SELECT
USING (auth.role() = 'authenticated');

-- Allow authenticated users to insert feedback
CREATE POLICY "Authenticated users can insert feedback"
ON public.knowledge_feedback
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

-- Allow authenticated users to update feedback
CREATE POLICY "Authenticated users can update feedback"
ON public.knowledge_feedback
FOR UPDATE
USING (auth.role() = 'authenticated');