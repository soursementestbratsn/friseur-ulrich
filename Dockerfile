# Minimal image for any Docker host (Fly.io, Koyeb, VPS).
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Site code (no data/ or node_modules - excluded by .dockerignore)
COPY . .

# Data is written to /app/data (override with DATA_DIR to use a volume)
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data

EXPOSE 8099
CMD ["node", "server.js"]
