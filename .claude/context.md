# TK Solution — Contexto do Projeto

## O que é esse sistema
Sistema interno da TK Solution para gestão de documentos (DMS) e consulta via IA (RAG).
Colaboradores fazem perguntas em linguagem natural sobre documentos da empresa.
O sistema também gerencia vencimentos de documentos e automações via email/WhatsApp.

## Stack obrigatória — não substitua sem perguntar
- Backend: Node.js + TypeScript + Hono
- Validação de dados: Zod (obrigatório em toda rota)
- Fila de tarefas: BullMQ + Redis (para PDFs e tarefas pesadas)
- Frontend: React + Vite + TypeScript + Tailwind + Shadcn UI
- Requisições frontend: TanStack Query (obrigatório — sem fetch puro)
- Banco de dados: Supabase (PostgreSQL + pgvector + Storage)
- LLM: OpenAI gpt-4o-mini (padrão) / gpt-4o (fallback complexo)
- Embeddings: text-embedding-3-small (NUNCA usar large)
- PDF parsing: LlamaParse (único — máxima precisão em formulários, tabelas e scans)
- Email: Nodemailer
- WhatsApp: Evolution API
- Monitoramento de erros: Sentry (backend + frontend)
- Segurança: consultar security/SKILL.md em todo desenvolvimento
- Deploy: Hostinger VPS KVM 4 (4 vCPU · 16GB RAM) — backend + frontend + Redis na mesma máquina
- Gerenciador de processos: PM2 (reinício automático, logs centralizados)
- Proxy reverso: Nginx (SSL, domínio, roteamento de portas)

## Este é um produto interno — não um SaaS
O sistema serve exclusivamente os colaboradores da TK Solution.
Não há cobrança, planos, multi-tenancy ou onboarding de clientes externos.
Não usar client_id em tabelas ou queries — não existe isolamento por empresa.
Autenticação via Supabase Auth restrita ao domínio @tksolution.com.br (ou domínio configurado).

## Filosofia de custo — REGRA MAIS IMPORTANTE
IA é o último recurso, não o primeiro.
Antes de chamar qualquer LLM ou API paga, o código resolve com lógica determinística.

Fluxo de decisão obrigatório:
1. Dá pra resolver com código/regex/SQL? → resolve em código
2. Não dá? → usa gpt-4o-mini
3. Mini falhou ou doc muito complexo? → gpt-4o como fallback (1 retry máximo)
4. Embeddings: SEMPRE checar cache (hash do texto) antes de gerar novo
5. PDF: sempre LlamaParse — precisão é crítica para extração de campos de documentos

## Proteção de custo — Rate Limiting
Toda rota que chama IA tem rate limiting por user_id.
Limite padrão: 60 requisições por minuto por usuário.
Retornar HTTP 429 quando exceder.

## Monitoramento
Sentry captura todos os erros de backend e frontend automaticamente.
Inicializar Sentry no topo de index.ts antes de qualquer outra coisa.

## Estrutura de pastas esperada
```
tk-hub/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── routes/       ← só recebe request, valida com Zod, chama service
│   │       ├── services/     ← lógica de negócio
│   │       ├── agents/       ← chamadas a LLM
│   │       ├── queues/       ← definição das filas BullMQ
│   │       ├── workers/      ← processadores das filas
│   │       └── lib/          ← clientes externos (supabase, openai, redis, sentry)
│   └── web/
│       └── src/
│           ├── components/   ← componentes React
│           ├── pages/        ← páginas
│           ├── hooks/        ← TanStack Query hooks
│           └── lib/          ← api client
├── packages/
│   └── shared/src/types/
└── supabase/migrations/
```

## O que NÃO fazer
- Não usar n8n — substituindo com código
- Não usar fetch puro no frontend — sempre TanStack Query
- Não criar rota sem validação Zod
- Não chamar LLM sem rate limit aplicado
- Não processar PDF dentro do request HTTP — vai para fila BullMQ
- Não guardar API keys no código — sempre .env
- Não inventar schema — consultar database/SKILL.md
