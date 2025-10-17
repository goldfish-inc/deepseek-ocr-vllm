# Build stage
FROM golang:1.24-alpine AS builder

# Install dependencies
RUN apk add --no-cache git=2.47.3-r0

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s" \
    -o csv-ingestion-worker \
    .

# Final stage - minimal image
FROM alpine:3.21

# Install ca-certificates for HTTPS and PostgreSQL client for debugging
RUN apk --no-cache add ca-certificates=20241010-r0 tzdata=2025a-r0 postgresql-client=16.7-r0

# Create non-root user
RUN addgroup -g 1000 -S appuser && \
    adduser -u 1000 -S appuser -G appuser

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/csv-ingestion-worker /app/csv-ingestion-worker

# Change ownership
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Run the binary
ENTRYPOINT ["/app/csv-ingestion-worker"]
