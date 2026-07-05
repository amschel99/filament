# Filament LSP API service. Multi-stage: build TS -> slim runtime.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# schema.sql is copied next to dist/db by the build script; keep it.
EXPOSE 3000
# Config comes entirely from env (see deploy/networks/*.env). The service reads HUB_RPC_URL etc.
CMD ["node", "dist/api/server.js"]
