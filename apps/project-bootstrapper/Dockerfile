# Build stage
FROM golang:1.23-alpine AS builder

WORKDIR /build

# Copy go module files
COPY go.* ./
RUN go mod download || true

# Copy source
COPY *.go ./

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -ldflags '-extldflags "-static"' -o bootstrapper .

# Runtime stage - alpine for DNS resolver support
FROM alpine:latest

# Install CA certificates
RUN apk --no-cache add ca-certificates

# Copy binary
COPY --from=builder /build/bootstrapper /bootstrapper

# Run as non-root (nobody:nobody)
USER 65534:65534

EXPOSE 8080

ENTRYPOINT ["/bootstrapper"]
