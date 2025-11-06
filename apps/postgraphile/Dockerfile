FROM node:20-alpine

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

# Install CA certificates for proper TLS verification
# hadolint ignore=DL3018
RUN apk add --no-cache ca-certificates

# Install minimal runtime deps locally for programmatic server (CORS + security headers)
RUN npm init -y \
 && npm i --only=prod express@4 postgraphile@4 cors@2 helmet@7 pg-connection-string@2 \
 && npm cache clean --force

# Copy server
COPY server.js ./

EXPOSE 8080

CMD ["node", "server.js"]
