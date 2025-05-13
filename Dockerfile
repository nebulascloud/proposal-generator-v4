# Use official Node.js LTS image
FROM node:18-alpine

# Install Chromium and necessary libraries for Puppeteer/html-pdf-node
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Set working directory
WORKDIR /app

# Copy package.json and package-lock
COPY package*.json ./

# Install production dependencies
RUN npm install --production

# Copy application code
COPY . .

# Expose application port
EXPOSE 3000

# Start the app
CMD ["node", "index.js"]
