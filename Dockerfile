# print-watch — runs the monitor server in a container.
# Ideal for watching many network cameras (http-snapshot / mjpeg) at once.
# The vision model (Ollama) runs OUTSIDE the container — point PW_OLLAMA_URL at it.

# ---- build stage: install all deps + compile TypeScript ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
# Don't pull the Electron binary just to build the server.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage: prod deps only + ffmpeg ----
FROM node:20-bookworm-slim
# ffmpeg: needed for `usb` capture (Linux device passthrough) and some stream types.
# sharp ships prebuilt binaries for linux/amd64 + arm64, so no build toolchain needed.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY web ./web
COPY config.json ./config.json

# Writable state lives on a volume so snapshots/history survive restarts.
ENV PW_DATA_DIR=/data
ENV PW_OLLAMA_URL=http://host.docker.internal:11434
VOLUME ["/data"]
EXPOSE 8787

CMD ["node", "dist/index.js"]
