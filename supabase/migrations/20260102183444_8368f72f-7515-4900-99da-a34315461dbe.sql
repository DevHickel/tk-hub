-- Adicionar política para admins poderem deletar activity_logs
CREATE POLICY "Admins can delete activity logs" 
ON public.activity_logs 
FOR DELETE 
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'tk_master'::app_role));

-- Adicionar política para admins poderem deletar mensagens
CREATE POLICY "Admins can delete messages" 
ON public.messages 
FOR DELETE 
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'tk_master'::app_role));