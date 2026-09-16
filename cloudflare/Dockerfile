FROM node:24-bookworm-slim AS media-libraries
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
# Keep the codec binaries and their shared libraries, without desktop GPU drivers.
RUN mkdir /media-runtime \
    && cp --parents /usr/bin/ffmpeg /usr/bin/ffprobe /media-runtime \
    && ldd /usr/bin/ffmpeg /usr/bin/ffprobe | awk '/=> \// {sub("^/lib/", "/usr/lib/", $3); print $3}' | sort -u \
      | xargs -r cp --parents --dereference -t /media-runtime \
    && cp -a --parents /usr/share/doc /media-runtime

FROM node:24-bookworm-slim
COPY --from=media-libraries /media-runtime/ /
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY engine/package.json ./engine/package.json
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY player-runtime/package.json ./player-runtime/package.json
COPY mobile/package.json ./mobile/package.json
RUN npm ci --omit=dev --omit=peer --ignore-scripts --workspace @aside/backend --workspace @aside/engine --include-workspace-root \
    && npm cache clean --force
COPY engine ./engine
COPY backend ./backend
USER node
EXPOSE 8080
CMD ["node", "--import", "tsx", "backend/src/container/index.ts"]
