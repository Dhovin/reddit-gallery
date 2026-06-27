# Use lightweight Node image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm install --only=production

# Copy application files
COPY server.js ./
COPY public/ ./public/

# Expose the default server port
EXPOSE 3000

# Environment configurations
ENV PORT=3000
ENV NODE_ENV=production
ENV DATA_DIR=/app/data

# Declare volume for persistent data
VOLUME ["/app/data"]

# Run the backend server
CMD ["node", "server.js"]
