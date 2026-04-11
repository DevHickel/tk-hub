#!/bin/bash
# Deploy de atualização — rodar após cada commit na main
# Uso: bash scripts/deploy.sh

set -e

echo "==> [1/5] Pull da branch main..."
git pull origin main

echo "==> [2/5] Instalando dependências..."
npm ci --prefix apps/api
npm ci

echo "==> [3/5] Build..."
cd apps/api && npm run build && cd ../..
npm run build  # frontend Vite

echo "==> [4/5] Aplicando migrations do Supabase..."
npx supabase db push

echo "==> [5/5] Recarregando processos PM2..."
pm2 reload ecosystem.config.cjs --env production

echo ""
echo "✅ Deploy concluído!"
pm2 status
