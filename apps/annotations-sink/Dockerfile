# Build stage
FROM golang:1.24.9-alpine AS builder

WORKDIR /build

# Copy go module files
COPY go.* ./
RUN go mod download

# Copy source
COPY *.go ./

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -ldflags '-extldflags "-static"' -o sink .

# Runtime stage - minimal scratch image
FROM scratch

# Copy CA certificates for HTTPS requests
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

# Copy binary
COPY --from=builder /build/sink /sink

# Run as non-root (nobody:nobody)
USER 65534:65534

EXPOSE 8080

ENTRYPOINT ["/sink"]
