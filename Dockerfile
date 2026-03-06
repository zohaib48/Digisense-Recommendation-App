# ── Build stage ──
FROM node:18-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# Copy source and build frontend
COPY . .
RUN npm run build

# ── Production stage ──
FROM node:18-alpine

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built frontend from builder
COPY --from=builder /app/dist ./dist

# Copy server code and public files
COPY server ./server
COPY public ./public
COPY shopify.app.toml ./

# Don't run as root
RUN addgroup -g 1001 -S appuser && adduser -S appuser -u 1001
USER appuser

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/index.js"]
