FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build

# ── Runtime — Nginx serve os arquivos estáticos ───────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

COPY nginx.frontend.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
