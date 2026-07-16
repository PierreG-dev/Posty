# =============================================================================
# Posty — image unique servant les deux services (web et worker).
# Coolify orchestrera deux services sur cette même image, avec des CMD distincts.
# =============================================================================

# --- deps --------------------------------------------------------------------
FROM node:20.11-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci --include=dev

# --- build -------------------------------------------------------------------
FROM node:20.11-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm run worker:build

# --- runtime -----------------------------------------------------------------
FROM node:20.11-alpine AS runner
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=Europe/Paris

# On copie les prod deps + le build. Pas de tsx en runtime : le worker est compilé.
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/dist-worker ./dist-worker
COPY --from=build /app/next.config.ts ./next.config.ts

RUN addgroup -g 1001 -S nodejs && adduser -S posty -u 1001 -G nodejs
RUN mkdir -p /data/assets && chown -R posty:nodejs /data /app
USER posty

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "next", "start", "-p", "3000"]
