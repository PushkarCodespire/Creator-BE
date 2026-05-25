# ===========================================
# PRODUCTION DOCKERFILE - BACKEND
# ===========================================
# Multi-stage build for optimized production image

# Stage 1: Builder
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci

# Copy Prisma schema first
COPY src/prisma ./src/prisma

# Generate Prisma client
RUN npx prisma generate --schema=src/prisma/schema.prisma

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# Stage 2: Production
FROM node:20-alpine

# Install dumb-init for signal handling + openssl CLI so Prisma's runtime
# platform detection can run `openssl version` and select the correct
# linux-musl-openssl-3.0.x engine (without it, detection fails and Prisma
# defaults to openssl-1.1.x which is not present on Alpine 3.17+).
RUN apk add --no-cache dumb-init openssl

# Create app directory
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package*.json ./

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy built application
COPY --from=builder /app/dist ./dist

# Copy Prisma files for migrations
COPY --from=builder /app/src/prisma ./src/prisma

# Copy seed/utility scripts so the K8s seed Job can run them
COPY --from=builder /app/scripts ./scripts

# Bake seed avatar images into the image so the entrypoint can copy them
# to the PVC (/app/uploads/) on first start without a network call.
COPY seed-assets ./seed-assets

# Entrypoint: creates upload sub-dirs + seeds avatars into PVC before Node starts
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Create directories for logs and uploads
RUN mkdir -p logs uploads data seed-assets/avatars && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# dumb-init → entrypoint → node
ENTRYPOINT ["dumb-init", "--", "/app/docker-entrypoint.sh"]

# Start the application
CMD ["node", "dist/src/index.js"]
