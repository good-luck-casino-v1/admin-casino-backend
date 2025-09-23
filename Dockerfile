# -------------------------------
# 🏗️ Casino Admin Backend Dockerfile
# -------------------------------
FROM node:18-alpine AS base

# Install system dependencies and security updates
RUN apk update && apk upgrade && apk add --no-cache \
    build-base \
    python3 \
    make \
    g++ \
    dumb-init \
    && rm -rf /var/cache/apk/*

# Create non-root user and group
RUN addgroup -S appgroup && adduser -S appuser -G appgroup -h /app

# Set working directory
WORKDIR /app

# Change ownership of the working directory
RUN chown -R appuser:appgroup /app

# Copy package files with correct ownership
COPY --chown=appuser:appgroup package*.json ./

#COPY .ENV #######
COPY .env .env

# Switch to non-root user for dependency installation
USER appuser

# Install dependencies with npm ci for faster, reliable builds
RUN npm ci --only=production --silent && npm cache clean --force

# Copy the rest of the application code
COPY --chown=appuser:appgroup . .

# Remove .env file if it exists (use secrets instead)
RUN rm -f .env

# Create necessary directories with proper permissions
RUN mkdir -p /app/logs /app/uploads /app/temp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "const http = require('http'); \
    http.get('http://localhost:5000/health', (res) => { \
      process.exit(res.statusCode === 200 ? 0 : 1) \
    }).on('error', () => process.exit(1))"

# Expose the application port
EXPOSE 5000

# Set environment to production
ENV NODE_ENV=production
ENV PORT=5000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Command to run the application
CMD ["node", "server.js"]