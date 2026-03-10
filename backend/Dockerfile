# ── Build Stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Install build dependencies for Prisma
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY package*.json ./
RUN npm ci --prefer-offline

COPY . .

# Generate Prisma client (required before running the server)
RUN npx prisma generate

# ── Production Stage ─────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Install production dependencies for Prisma
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Install only production deps
COPY package*.json ./
RUN npm ci --only=production --prefer-offline

# Copy app source
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
