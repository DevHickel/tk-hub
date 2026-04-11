# TK Solution — DMS + RAG Interno

Sistema interno da TK Solution para gestão de documentos (DMS) e assistente de IA com RAG.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React + Vite + TypeScript + Tailwind + Shadcn UI |
| Backend | Node.js + Hono + TypeScript |
| Banco | Supabase (PostgreSQL + pgvector + Storage + Auth) |
| IA | OpenAI (gpt-4o-mini / gpt-4o) + LlamaParse |
| Filas | BullMQ + Redis |
| Deploy | PM2 + Nginx na VPS |
| Monitoramento | Sentry |

## Estrutura do projeto

```
tk-hub/
├── src/                    # Frontend React (Vite)
│   ├── pages/              # Dashboard, Chat, Documents, ReportSettings
│   ├── hooks/              # useDocuments, useChat, useJobStatus, useUploadDocument
│   └── lib/api.ts          # Cliente de API tipado
├── apps/api/               # Backend Hono
│   └── src/
│       ├── routes/         # rag, dms, reports
│       ├── agents/         # rag.agent.ts
│       ├── workers/        # pdf.worker.ts, email.worker.ts
│       ├── services/       # embedding, llamaparse, reports, gmail
│       └── lib/            # supabase, redis, openai, logger
├── supabase/
│   └── migrations/         # SQL migrations versionadas
├── nginx/tksolution.conf   # Config Nginx com SSL e rate limit
├── scripts/
│   ├── setup-vps.sh        # Setup inicial da VPS (rodar 1x)
│   └── deploy.sh           # Deploy de atualização
└── ecosystem.config.cjs    # PM2: api (3000) + web (4000) + worker
```

---

## Desenvolvimento local

### Pré-requisitos

- Node.js 20+
- Redis rodando localmente (`redis-server`)
- Conta Supabase com projeto criado
- Chaves: OpenAI API key, LlamaParse API key

### 1. Variáveis de ambiente

**Frontend** — copie e preencha `.env`:
```bash
VITE_SUPABASE_URL=https://SEU_PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...   # anon key (pública)
VITE_API_URL=http://localhost:3000
```

**Backend** — crie `apps/api/.env`:
```bash
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_SERVICE_KEY=eyJ...            # service role key (secreta)
SUPABASE_ANON_KEY=eyJ...              # anon key
OPENAI_API_KEY=sk-...
LLAMAPARSE_API_KEY=llx-...
REDIS_URL=redis://localhost:6379
ALLOWED_EMAIL_DOMAIN=tksolution.com.br
FRONTEND_URL=http://localhost:5173
SENTRY_DSN=https://...@sentry.io/...  # opcional em dev
GMAIL_WEBHOOK_TOKEN=token-secreto-aleatorio
GMAIL_CLIENT_ID=...                   # OAuth2 Gmail (opcional)
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
```

### 2. Migrations do banco

```bash
npx supabase db push
```

### 3. Rodar em desenvolvimento

```bash
# Terminal 1 — Frontend
npm install
npm run dev

# Terminal 2 — Backend
cd apps/api
npm install
npm run dev
```

Acesse: `http://localhost:5173`

---

## Deploy na VPS

### Pré-requisitos na VPS

```bash
# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2
npm install -g pm2

# Redis
sudo apt install redis-server -y
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Nginx
sudo apt install nginx -y
sudo systemctl enable nginx
```

### Setup inicial (1x apenas)

```bash
# Clone o repositório na VPS
git clone <URL_DO_REPO> /var/www/tk-hub
cd /var/www/tk-hub

# Crie apps/api/.env com todas as variáveis (ver seção acima)
nano apps/api/.env

# Execute o script de setup
bash scripts/setup-vps.sh
```

O `setup-vps.sh` faz:
1. Configura Nginx + symlink em `sites-enabled`
2. Gera certificado SSL via Certbot (Let's Encrypt)
3. Build do backend e frontend
4. Inicia PM2 e salva configuração para sobreviver a reboot

### Deploy de atualização

```bash
bash scripts/deploy.sh
```

O `deploy.sh` faz:
1. `git pull origin main`
2. `npm ci` (backend + frontend)
3. Build (backend TypeScript + frontend Vite)
4. `supabase db push` (aplica migrations novas)
5. `pm2 reload` (zero-downtime restart)

---

## Processos PM2

| Nome | Porta | Descrição |
|------|-------|-----------|
| `api` | 3000 | Servidor Hono (rotas REST) |
| `web` | 4000 | Frontend estático servido via `serve` |
| `worker` | — | Workers BullMQ (PDF + email) |

```bash
pm2 status          # ver estado dos processos
pm2 logs api        # logs do backend
pm2 logs worker     # logs dos workers
pm2 restart api     # reiniciar manualmente
```

---

## Rotas principais da API

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/chat` | Pergunta ao RAG |
| POST | `/api/upload` | Upload de PDF |
| GET | `/api/jobs/:id/status` | Status do processamento |
| GET | `/api/documents` | Lista documentos DMS |
| PATCH | `/api/documents/:id` | Atualiza documento |
| DELETE | `/api/documents/:id` | Arquiva documento |
| POST | `/api/webhook/gmail` | Webhook Pub/Sub Gmail |
| GET | `/api/reports/config` | Configuração de relatórios |
| PUT | `/api/reports/config` | Atualiza configuração |
| GET | `/api/reports/recipients` | Lista destinatários |
| POST | `/api/reports/recipients` | Adiciona destinatário |
| DELETE | `/api/reports/recipients/:id` | Remove destinatário |
| POST | `/api/reports/send-test` | Envia relatório de teste |
| GET | `/health` | Health check |

---

## Relatórios automáticos

Três relatórios são enviados por e-mail todo **domingo às 00:00 BRT**:

- **Gestão** — horas economizadas, valor em R$, documentos vencendo
- **RH** — vencimentos por colaborador
- **TI** — custo de IA por modelo, cache hits, jobs processados

Configure destinatários e benchmarks em `/report-settings` (requer role `admin`, `manager` ou `tk_master`).

---

## Segurança

- JWT verificado via Supabase Auth em toda requisição
- Role lida da tabela `profiles` (não de `user_metadata`)
- Domínio de e-mail restrito a `@tksolution.com.br`
- Rate limit: 200 req/min geral · 60 req/min IA · 3/hora send-test
- Upload: validação por magic bytes (`%PDF`) + UUID filename + hash dedup
- Prompt injection: `sanitizeForPrompt()` em todos os chunks RAG
- CORS restrito ao `FRONTEND_URL`
- Headers: `secureHeaders()` (CSP, X-Frame-Options, etc.)
