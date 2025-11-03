FROM golang:1.24.9-alpine AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg \
    go build -o /out/pdf-ingestion-worker ./

# hadolint ignore=DL3007
FROM gcr.io/distroless/base-debian12:latest
WORKDIR /app
COPY --from=build /out/pdf-ingestion-worker /usr/local/bin/pdf-ingestion-worker
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/pdf-ingestion-worker"]
