FROM oven/bun:1-alpine
USER root
RUN apk add --no-cache git ca-certificates
COPY apply-catalog-corrections.js /opt/bindarr/apply-catalog-corrections.js
WORKDIR /work
