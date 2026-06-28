# Stage 1: Build the Vite React Frontend
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency configs
COPY package*.json ./

# Install all dependencies (including devDependencies for building)
RUN npm install

# Copy source code files
COPY vite.config.js tailwind.config.js postcss.config.js index.html ./
COPY src/ ./src/

# Compile the React production bundle to dist/
RUN npm run build


# Stage 2: Final Light Runtime Image
FROM node:22-alpine

WORKDIR /app

# Install runtime utilities: nginx (web server), su-exec (privilege dropper), shadow (for usermod/groupmod)
RUN apk add --no-cache nginx su-exec shadow

# Copy backend dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy built frontend assets from builder stage
COPY --from=builder /app/dist ./dist

# Copy backend server code and startup script
COPY server.js ./
COPY nginx.conf ./
COPY entrypoint.sh ./

# Move Nginx config to system config path
RUN mv nginx.conf /etc/nginx/nginx.conf

# Set permissions for startup script
RUN chmod +x entrypoint.sh

# Expose Nginx frontend port (3000)
EXPOSE 3000

# Declare persistent data volume
VOLUME ["/app/data"]

# Run the entrypoint script
ENTRYPOINT ["/app/entrypoint.sh"]
