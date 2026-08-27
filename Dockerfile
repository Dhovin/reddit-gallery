# Use Node 22 Alpine (supporting native SQLite)
FROM node:22-alpine

WORKDIR /app

# Install runtime utilities: su-exec (privilege dropper), shadow (for usermod/groupmod)
RUN apk add --no-cache su-exec shadow

# Copy dependency files
COPY package*.json ./

# Install only production dependencies
RUN npm install --only=production

# Copy application files and folders
COPY server.js ./
COPY entrypoint.sh ./
COPY public/ ./public/

# Set execution permissions on entrypoint wrapper
RUN chmod +x entrypoint.sh

# Expose Node backend port
EXPOSE 3000

# Declare data volume path
VOLUME ["/app/data"]

# Health check for Docker and unRaid monitoring
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

# Run startup script
ENTRYPOINT ["/app/entrypoint.sh"]
