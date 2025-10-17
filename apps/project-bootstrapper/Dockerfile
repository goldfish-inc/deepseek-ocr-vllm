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
FROM alpine:3.21

# Install CA certificates and debugging tools for internal dev velocity
RUN apk --no-cache add ca-certificates=20241010-r0 curl=8.11.1-r2 jq=1.7.1-r0 bash=5.2.37-r0

# Copy binary
COPY --from=builder /build/bootstrapper /bootstrapper

# Run as non-root (nobody:nobody)
USER 65534:65534

EXPOSE 8080

ENTRYPOINT ["/bootstrapper"]
