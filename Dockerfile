# Build the PWA
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test && npm run build

# PocketBase serves the app (pb_public) and the API on one origin
FROM alpine:3.22
ARG PB_VERSION=0.40.6
RUN apk add --no-cache ca-certificates unzip wget \
 && case "$(uname -m)" in \
      x86_64) arch=amd64 ;; \
      aarch64) arch=arm64 ;; \
      armv7l) arch=armv7 ;; \
      *) echo "Unsupported architecture: $(uname -m)" && exit 1 ;; \
    esac \
 && cd /tmp \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${arch}.zip" \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/checksums.txt" \
 && grep "linux_${arch}.zip" checksums.txt | sha256sum -c - \
 && unzip -q "pocketbase_${PB_VERSION}_linux_${arch}.zip" -d /pb \
 && rm -f /tmp/*.zip /tmp/checksums.txt
WORKDIR /pb
COPY server/pb_migrations ./pb_migrations
COPY server/entrypoint.sh ./entrypoint.sh
COPY --from=build /app/dist ./pb_public
RUN chmod +x ./entrypoint.sh
EXPOSE 8090
VOLUME /pb/pb_data
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8090/api/health >/dev/null || exit 1
ENTRYPOINT ["/pb/entrypoint.sh"]
