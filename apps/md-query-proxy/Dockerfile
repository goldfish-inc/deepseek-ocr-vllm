FROM node:20

ARG DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install CA certificates for TLS (MotherDuck requires system CAs)
# Use retries and --allow-unauthenticated as fallback for transient hash mismatches
RUN apt-get clean && rm -rf /var/lib/apt/lists/* && \
    (apt-get -o Acquire::Retries=3 update && apt-get install -y --no-install-recommends ca-certificates curl || \
     apt-get update --allow-insecure-repositories && apt-get install -y --allow-unauthenticated --no-install-recommends ca-certificates curl) && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# System dependencies for duckdb can be minimal; use slim base
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
