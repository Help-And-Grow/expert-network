FROM node:20-slim

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --production 2>/dev/null || npm install --production
COPY src/ src/

EXPOSE 8080
CMD ["node", "src/server.mjs"]
