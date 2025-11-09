FROM node:20-bookworm-slim

WORKDIR /app

# System dependencies for duckdb can be minimal; use slim base
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
