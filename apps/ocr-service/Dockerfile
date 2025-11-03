FROM golang:1.24.9-alpine AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg \
    go build -o /out/ocr-service ./

# hadolint ignore=DL3007
FROM gcr.io/distroless/base-debian12:latest
WORKDIR /app
COPY --from=build /out/ocr-service /usr/local/bin/ocr-service
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/ocr-service"]
