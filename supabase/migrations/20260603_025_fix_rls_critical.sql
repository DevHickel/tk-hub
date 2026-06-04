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
-- Cada bloco é tolerante a tabela ausente: se a tabela não existir nesta
-- instância do banco, o bloco é pulado (NO-OP) e o restante continua.
-- Isso é necessário porque algumas migrations antigas (ex: document_chunks)
-- nunca foram aplicadas em produção.
--
-- RPCs match_documents_with_feedback e apply_chunk_feedback são chamadas APENAS
-- pelo backend (apps/api/src/agents/rag.agent.ts, routes/rag.routes.ts) com
-- service_role, então restringir SELECT pra authenticated não quebra o RAG.

-- ============================================================================
-- 1. chat_history — cada usuário só lê suas próprias conversas
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'chat_history'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "authenticated read chat_history"  ON public.chat_history';
    EXECUTE 'DROP POLICY IF EXISTS "authenticated insert chat_history" ON public.chat_history';
    EXECUTE 'DROP POLICY IF EXISTS "chat_history_own_select"           ON public.chat_history';
    EXECUTE 'DROP POLICY IF EXISTS "chat_history_admin_select"         ON public.chat_history';

    EXECUTE 'CREATE POLICY "chat_history_own_select" ON public.chat_history
               FOR SELECT TO authenticated
               USING (user_id = auth.uid())';

    EXECUTE 'CREATE POLICY "chat_history_admin_select" ON public.chat_history
               FOR SELECT TO authenticated
               USING (EXISTS (
                 SELECT 1 FROM public.user_roles
                 WHERE user_id = auth.uid() AND role IN (''admin'',''manager'')
               ))';
  END IF;
END $$;

-- ============================================================================
-- 2. document_chunks — chunks visíveis só pra dono do documento + manager/admin
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'document_chunks'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "authenticated read document_chunks"               ON public.document_chunks';
    EXECUTE 'DROP POLICY IF EXISTS "document_chunks_owner_or_manager_select"          ON public.document_chunks';

    EXECUTE 'CREATE POLICY "document_chunks_owner_or_manager_select" ON public.document_chunks
               FOR SELECT TO authenticated
               USING (
                 EXISTS (
                   SELECT 1 FROM public.documents d
                   WHERE d.id = document_chunks.document_id
                     AND d.uploaded_by = auth.uid()
                 )
                 OR EXISTS (
                   SELECT 1 FROM public.user_roles
                   WHERE user_id = auth.uid() AND role IN (''admin'',''manager'')
                 )
               )';
  END IF;
END $$;

-- ============================================================================
-- 3. chunk_feedback — usuário só lê o que ele mesmo votou
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'chunk_feedback'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "authenticated can read chunk_feedback" ON public.chunk_feedback';
    EXECUTE 'DROP POLICY IF EXISTS "chunk_feedback_own_select"             ON public.chunk_feedback';
    EXECUTE 'DROP POLICY IF EXISTS "chunk_feedback_admin_select"           ON public.chunk_feedback';

    EXECUTE 'CREATE POLICY "chunk_feedback_own_select" ON public.chunk_feedback
               FOR SELECT TO authenticated
               USING (user_id = auth.uid())';

    EXECUTE 'CREATE POLICY "chunk_feedback_admin_select" ON public.chunk_feedback
               FOR SELECT TO authenticated
               USING (EXISTS (
                 SELECT 1 FROM public.user_roles
                 WHERE user_id = auth.uid() AND role IN (''admin'',''manager'')
               ))';

    -- INSERT/UPDATE já restritos a own user_id em 20260413_015 — manter.
  END IF;
END $$;

-- ============================================================================
-- 4. embedding_cache — revoga acesso authenticated (uso 100% interno)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'embedding_cache'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "authenticated read embedding_cache" ON public.embedding_cache';
    -- Sem policies = só service_role (bypassa RLS) tem acesso. Frontend não usa.
  END IF;
END $$;

-- ============================================================================
-- 5. knowledge_feedback — mesma coisa (legado, uso interno)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'knowledge_feedback'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can view feedback"   ON public.knowledge_feedback';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can insert feedback" ON public.knowledge_feedback';
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can update feedback" ON public.knowledge_feedback';
    EXECUTE 'ALTER TABLE public.knowledge_feedback ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
