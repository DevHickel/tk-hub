# TK Solution — TK Hub

Plataforma interna da TK Solution: gestão de documentos (DMS), assistente de IA com RAG sobre a base de conhecimento, controle de certificados de treinamento e relatórios semanais automatizados.

> Software interno — uso restrito. Sem licença pública.

---

## Stack

| Camada        | Tecnologia |
|---------------|------------|
| Frontend      | React 18 + Vite + TypeScript + Tailwind + shadcn/ui (Radix) |
| Backend       | Node 20 + Hono + TypeScript |
| Banco         | Supabase (PostgreSQL + pgvector + Storage + Auth) |
| IA            | OpenAI (`gpt-4o-mini`, `gpt-4o`, embeddings `text-embedding-3-small`) |
| OCR/Visão     | `mupdf` (PDF → imagem) + `gpt-4.1-mini` vision (extração de markdown) |
| Email         | nodemailer (SMTP, config via UI) + `imapflow` (monitoramento IMAP) + Gmail API (webhook Pub/Sub opcional) |
| Filas         | BullMQ + Redis |
| Deploy        | Easypanel (build automático no push) |
| Monitoramento | Sentry (backend) |

---

## Estrutura do projeto

```
tk-hub/
├── src/                         # Frontend React (Vite)
│   ├── pages/                   # Login, Chat, Dashboard, Documents, Admin,
│   │                            # ReportSettings, BugReport, Settings, etc.
│   ├── components/              # AppSidebar, ChatMessage, ui/* (shadcn), etc.
│   ├── contexts/                # AuthContext, ThemeContext, MobileNavContext
│   ├── hooks/                   # useSidebarCollapsed, useIsMobile, etc.
│   ├── integrations/supabase/   # Supabase client + tipos gerados
│   └── lib/api.ts               # Cliente HTTP tipado para o backend
├── apps/api/                    # Backend Hono
│   └── src/
│       ├── routes/              # rag, dms, reports, certificates, invites, register
│       ├── agents/              # rag.agent.ts — orquestração do RAG
│       ├── workers/             # certificate, document/email workers (BullMQ)
│       ├── services/            # vision-parser, embedding, email, inbox-monitor,
│       │                        # reports/*, cron, notification
│       └── lib/                 # supabase (service-role), openai, redis, logger
├── supabase/migrations/         # SQL versionado
├── .claude/skills/              # Convenções obrigatórias (backend, frontend,
│                                # database, dms, queue, rag-pipeline, reports, security)
└── scripts/                     # setup-vps.sh / deploy.sh (legado VPS)
```

---

## Desenvolvimento local

### Pré-requisitos

- Node.js 20+
- Redis local (`redis-server`)
- Projeto Supabase criado
- Chave OpenAI

### 1. Variáveis de ambiente

**Frontend** — `.env`:
```bash
VITE_SUPABASE_URL=https://SEU_PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...          # anon key (pública)
VITE_API_URL=http://localhost:3000
```

**Backend** — `apps/api/.env`:
```bash
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_SERVICE_KEY=eyJ...                    # service role key (secreta!)
SUPABASE_ANON_KEY=eyJ...
OPENAI_API_KEY=sk-...
REDIS_URL=redis://localhost:6379
FRONTEND_URL=http://localhost:5173
SENTRY_DSN=https://...@sentry.io/...           # opcional em dev
# Opcionais — fluxo Gmail Pub/Sub:
GMAIL_WEBHOOK_TOKEN=token-secreto
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
```

> **SMTP e IMAP de certificados** são configurados pelo painel `/admin` (tabelas `email_config` e `certificate_email_accounts`), não por env var.

### 2. Migrations

```bash
npx supabase db push
```

### 3. Rodar

```bash
# Terminal 1 — frontend
npm install
npm run dev              # http://localhost:5173

# Terminal 2 — backend
cd apps/api
npm install
npm run dev              # http://localhost:3000
```

---

## Deploy (Easypanel)

O fluxo padrão é **CI por push**: Easypanel observa a branch `main` e dispara build automaticamente para `tk-frontend` e `tk-api`.

### Para apagar e recriar a integração GitHub

Se um deploy falhar com `Cannot find public repository and your Github token is invalid`, a credencial GitHub do Easypanel expirou. Reconectar em **Easypanel → Settings → Git providers** (refresh do token / re-OAuth do GitHub App).

### Migrations em produção

Easypanel deploya **só o código**. Migrations em `supabase/migrations/` precisam ser aplicadas manualmente no SQL Editor do Supabase (ou via `supabase db push` com as credenciais do projeto).

### Deploy manual em VPS (legado)

Scripts `scripts/setup-vps.sh` e `scripts/deploy.sh` ainda existem pra deploy bare-metal com PM2 + Nginx; não são o caminho padrão hoje.

---

## Rotas principais (backend)

| Método | Rota | Descrição |
|--------|------|-----------|
| POST   | `/api/chat`                            | Pergunta ao RAG |
| POST   | `/api/upload`                          | Upload de PDF pra base RAG |
| GET    | `/api/jobs/:id/status`                 | Status de job BullMQ |
| GET    | `/api/documents`                       | Lista documentos do DMS |
| PATCH  | `/api/documents/:id`                   | Atualiza documento |
| DELETE | `/api/documents/:id`                   | Arquiva documento |
| POST   | `/api/certificates/:id/extract`        | Enfileira extração via IA |
| GET    | `/api/certificate-inboxes`             | Lista caixas IMAP monitoradas (admin) |
| POST   | `/api/certificate-inboxes`             | Cria caixa IMAP (admin) |
| POST   | `/api/invites`                         | Convida usuário (admin/manager) |
| POST   | `/api/register`                        | Cadastro via token de convite |
| GET    | `/api/reports/config`                  | Configuração de relatórios |
| PUT    | `/api/reports/config`                  | Atualiza configuração |
| GET    | `/api/reports/recipients`              | Destinatários |
| POST   | `/api/reports/recipients`              | Adiciona destinatário |
| POST   | `/api/reports/send-test`               | Envia teste |
| POST   | `/api/webhook/gmail`                   | Webhook Pub/Sub Gmail |
| GET    | `/health`                              | Health check |

---

## Relatórios automáticos

Três relatórios saem por e-mail todo **domingo às 00:00 BRT** (timezone configurável):

- **Gestão** — horas economizadas, ROI, alertas de certificados
- **RH** — vencimentos por colaborador
- **TI** — custo de IA por modelo, cache hit-rate, jobs processados, bug reports da semana

Destinatários, benchmarks e domingo de envio são configurados em `/report-settings` (requer role `admin` ou `manager`).

---

## Segurança

- JWT verificado via Supabase Auth em toda requisição protegida (middleware em [apps/api/src/index.ts](apps/api/src/index.ts))
- Role lida da tabela `user_roles` (source of truth — nunca de `user_metadata`)
- Headers de segurança: `secureHeaders()` (CSP, X-Frame-Options, etc.)
- Rate limit global: 200 req/min por IP; endpoints sensíveis (`/api/register`, `/api/invites`) com limite mais agressivo
- Upload: magic-bytes + UUID no nome + hash dedup
- Prompt injection: sanitização de chunks antes do prompt RAG
- Markdown do chat renderizado com `rehype-sanitize` (defesa em profundidade contra HTML/JS)
- RLS no Postgres: tabelas privadas (`chat_history`, `document_chunks`, `chunk_feedback`) com escopo por `user_id` / dono; tabelas internas (`embedding_cache`, `knowledge_feedback`) só via `service_role`

---

## Convenções

Cada área tem um documento curto de regras em [.claude/skills/](.claude/skills/) — consulta obrigatória ao mexer:

- `backend/SKILL.md` — padrões Hono, validação, error handling
- `frontend/SKILL.md` — padrões React, TanStack Query, shadcn
- `database/SKILL.md` — schema e padrões de acesso Supabase
- `dms/SKILL.md` — triagem de email, extração de campos, vencimentos
- `queue/SKILL.md` — BullMQ + Redis
- `rag-pipeline/SKILL.md` — embedding, busca híbrida, geração
- `reports/SKILL.md` — relatórios semanais (3 públicos, benchmarks)
- `security/SKILL.md` — regras obrigatórias de segurança

---

## Stack de processos (PM2 — legado VPS)

| Nome    | Porta | Descrição |
|---------|-------|-----------|
| `api`   | 3000  | Servidor Hono |
| `web`   | 4000  | Frontend estático (`serve`) |
| `worker`| —     | Workers BullMQ |

No Easypanel cada serviço (`tk-api`, `tk-frontend`, `tk-redis`) é um container separado.
