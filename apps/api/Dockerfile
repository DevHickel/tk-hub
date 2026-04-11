FROM node:22-alpine AS builder

WORKDIR /app

# Copiar arquivos do monorepo a partir da raiz
COPY apps/api/package*.json ./
RUN npm ci

COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src

RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

COPY apps/api/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/index.js"]
