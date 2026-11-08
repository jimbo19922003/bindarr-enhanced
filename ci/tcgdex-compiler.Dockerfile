FROM oven/bun:1-alpine
USER root
RUN apk add --no-cache git ca-certificates
WORKDIR /work
