-- Endurece RLS de tabelas internas que estavam acessíveis a qualquer authenticated
-- (vazamento entre usuários). Backend continua tudo via service_role, que bypassa RLS.
--
-- Tabelas tratadas:
--   1. chat_history       — perguntas/respostas de cada usuário (privadas)
--   2. document_chunks    — conteúdo RAG por documento
--   3. chunk_feedback     — votos de feedback no chat (contém pergunta original)
--   4. embedding_cache    — cache de embeddings (text_preview pode vazar conteúdo)
--   5. knowledge_feedback — tabela legada de feedback (uso só interno)
--
-- RPCs match_documents_with_feedback e apply_chunk_feedback são chamadas APENAS
-- pelo backend (apps/api/src/agents/rag.agent.ts, routes/rag.routes.ts) com
-- service_role, então restringir SELECT pra authenticated não quebra o RAG.

-- ============================================================================
-- 1. chat_history — cada usuário só lê suas próprias conversas
-- ============================================================================
DROP POLICY IF EXISTS "authenticated read chat_history"  ON public.chat_history;
DROP POLICY IF EXISTS "authenticated insert chat_history" ON public.chat_history;

CREATE POLICY "chat_history_own_select" ON public.chat_history
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Manager/admin podem ler todo o histórico (auditoria)
CREATE POLICY "chat_history_admin_select" ON public.chat_history
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('admin','manager')
  ));

-- INSERT/UPDATE: somente backend (service_role bypassa RLS). Sem policy = nada permitido pra authenticated.

-- ============================================================================
-- 2. document_chunks — chunks visíveis só pra dono do documento + manager/admin
-- ============================================================================
DROP POLICY IF EXISTS "authenticated read document_chunks" ON public.document_chunks;

CREATE POLICY "document_chunks_owner_or_manager_select" ON public.document_chunks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.id = document_chunks.document_id
        AND d.uploaded_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('admin','manager')
    )
  );

-- ============================================================================
-- 3. chunk_feedback — usuário só lê o que ele mesmo votou
-- ============================================================================
DROP POLICY IF EXISTS "authenticated can read chunk_feedback" ON public.chunk_feedback;

CREATE POLICY "chunk_feedback_own_select" ON public.chunk_feedback
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "chunk_feedback_admin_select" ON public.chunk_feedback
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('admin','manager')
  ));

-- INSERT/UPDATE já restritos a own user_id em 20260413_015 — manter.

-- ============================================================================
-- 4. embedding_cache — revoga acesso authenticated (uso 100% interno)
-- ============================================================================
DROP POLICY IF EXISTS "authenticated read embedding_cache" ON public.embedding_cache;
-- Sem policies = só service_role (bypassa RLS) tem acesso. Frontend não usa.

-- ============================================================================
-- 5. knowledge_feedback — mesma coisa (legado, uso interno)
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated users can view feedback"   ON public.knowledge_feedback;
DROP POLICY IF EXISTS "Authenticated users can insert feedback" ON public.knowledge_feedback;
DROP POLICY IF EXISTS "Authenticated users can update feedback" ON public.knowledge_feedback;
-- Garantir RLS habilitada (caso esteja off por algum motivo)
ALTER TABLE public.knowledge_feedback ENABLE ROW LEVEL SECURITY;
