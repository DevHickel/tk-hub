#!/bin/bash
# Setup inicial da VPS — rodar apenas 1 vez
# Pré-requisito: Node 20, PM2, Redis e Nginx já instalados via SSH:
#   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs
#   npm install -g pm2
#   sudo apt install redis-server -y && sudo systemctl enable redis-server
#   sudo apt install nginx -y && sudo systemctl enable nginx

set -e

DOMAIN="sistema.tksolution.com.br"
APP_DIR="/var/www/tk-hub"

echo "==> Configurando Nginx..."
sudo cp nginx/tksolution.conf /etc/nginx/sites-available/tksolution
sudo ln -sf /etc/nginx/sites-available/tksolution /etc/nginx/sites-enabled/tksolution
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "==> Instalando Certbot e gerando SSL..."
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m ops@tksolution.com.br

echo "==> Criando diretório de logs..."
mkdir -p logs

echo "==> Configurando PM2 startup (reinício automático após reboot)..."
pm2 startup systemd -u $USER --hp $HOME
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME

echo "==> Primeiro build e start dos processos..."
cd apps/api && npm ci && npm run build && cd ../..
npm run build  # build do frontend Vite

echo "==> Iniciando processos PM2..."
pm2 start ecosystem.config.cjs --env production
pm2 save  # salva configuração para sobreviver a reboot

echo ""
echo "✅ Setup concluído!"
echo "   API:      https://$DOMAIN/api/health"
echo "   Frontend: https://$DOMAIN"
echo "   PM2:      pm2 status"
