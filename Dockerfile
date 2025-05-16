# Use official Node.js LTS image
FROM node:18-alpine

# Set production environment for npm install
ENV NODE_ENV=production

# Install Chromium and necessary libraries for Puppeteer/html-pdf-node
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    curl \
    && rm -rf /var/cache/apk/*
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Set working directory
WORKDIR /app

# Copy package.json and package-lock
COPY package*.json ./

# Install production dependencies
RUN npm install --production \
    && npm prune --production \
    && npm cache clean --force

# Copy application code
COPY . .

# Expose application port
EXPOSE 3000

# Start the app
CMD ["node", "index.js"]
