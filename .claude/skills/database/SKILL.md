---
name: database
description: Schema do Supabase e padrões de acesso ao banco
---

# Database — Schema e Padrões

## ID do projeto Supabase
bzhfeqdwxdmvydrdsdno

## Modelo de dados — produto interno
Não há isolamento por empresa. Todos os colaboradores da TK Solution
acessam o mesmo conjunto de dados. Controle de acesso por `role` do usuário.

## Tabelas

### users (gerenciada pelo Supabase Auth — não criar manualmente)
O Supabase Auth já cria `auth.users`. Adicionar metadados via:
```sql
-- role: 'user' | 'manager' | 'admin'
-- definido no user_metadata do Supabase Auth
```

### documents
```sql
create table documents (
  id uuid default gen_random_uuid() primary key,
  uploaded_by uuid references auth.users(id),
  file_name text not null,
  file_path text not null,
  file_hash text not null,
  content text,
  tipo text,
  numero text,
  colaborador text,
  data_emissao date,
  data_vencimento date,
  emissor text,
  status text default 'queued',
  -- status: queued | processing | active | expired | error | archived
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### document_chunks
```sql
create table document_chunks (
  id uuid default gen_random_uuid() primary key,
  document_id uuid references documents(id) on delete cascade,
  content text not null,
  chunk_index int not null,
  embedding vector(1536),
  created_at timestamptz default now()
);

create index on document_chunks
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);

create index on document_chunks
using gin(to_tsvector('portuguese', content));
```

### embedding_cache
```sql
create table embedding_cache (
  id uuid default gen_random_uuid() primary key,
  hash text not null unique,
  embedding vector(1536) not null,
  text_preview text,
  hit_count int default 1,
  created_at timestamptz default now()
);
```

### chat_history
```sql
create table chat_history (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id),
  question text not null,
  answer text not null,
  chunks_used jsonb,
  model_used text,
  tokens_used int,
  created_at timestamptz default now()
);
```

## Row Level Security — produto interno

RLS habilitado mas políticas simples: qualquer usuário autenticado acessa tudo.
Controle de escrita por role (admin/manager) feito no backend, não no RLS.

```sql
alter table documents enable row level security;
alter table document_chunks enable row level security;
alter table chat_history enable row level security;
alter table embedding_cache enable row level security;

-- qualquer usuário autenticado lê tudo
create policy "authenticated read" on documents
  for select using (auth.role() = 'authenticated');

create policy "authenticated read" on document_chunks
  for select using (auth.role() = 'authenticated');

create policy "authenticated read" on chat_history
  for select using (auth.role() = 'authenticated');

-- backend usa service key — bypassa RLS para writes
-- nunca fazer writes direto do frontend
```

## Padrão de query — sem client_id

```typescript
// produto interno — sem filtro por empresa
const { data } = await supabase
  .from('documents')
  .select('*')
  .eq('status', 'active')
  .order('created_at', { ascending: false })
```

## Migrations

Todo novo campo ou tabela: arquivo em `supabase/migrations/`
Nomenclatura: `YYYYMMDD_descricao.sql`

## Tabelas do sistema de relatórios

### report_config
```sql
create table report_config (
  id uuid default gen_random_uuid() primary key,
  language text default 'pt',
  hour_cost_brl numeric default 35,
  benchmark_search_min int default 8,
  benchmark_doc_process_min int default 25,
  benchmark_alert_min int default 5,
  benchmark_email_triage_min int default 10,
  updated_at timestamptz default now()
  -- tabela com apenas 1 linha — configuração única da TK Solution
);
```

### report_recipients
```sql
create table report_recipients (
  id uuid default gen_random_uuid() primary key,
  email text not null,
  name text not null,
  report_type text not null,
  -- report_type: 'management' | 'hr' | 'it' | 'all'
  active boolean default true,
  created_at timestamptz default now(),
  unique(email, report_type)
);
```

### weekly_report_log
```sql
create table weekly_report_log (
  id uuid default gen_random_uuid() primary key,
  report_type text not null,
  week_start date not null,
  week_end date not null,
  recipients_count int,
  metrics_snapshot jsonb,
  sent_at timestamptz default now(),
  status text default 'sent'
);
```
