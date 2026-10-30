# ==========================================
# 0. WHISPER: whisper.cpp CLI and its model (this stage is never published)
# ==========================================
FROM node:26.10.0-alpine AS whisper
RUN apk add --no-cache build-base cmake git curl
ARG WHISPER_CPP_TAG=v1.9.5
ARG WHISPER_MODEL_REV=5359861c739e955e79d9a303bcbc70fb988958b1
ARG WHISPER_MODEL_SHA256=ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb
# GGML_NATIVE=OFF: no -march=native, so the binary runs on any amd64 or arm64 host.
RUN git clone --depth 1 --branch "${WHISPER_CPP_TAG}" https://github.com/ggml-org/whisper.cpp /src && \
    cd /src && \
    cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
      -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON -DCMAKE_INSTALL_RPATH='$ORIGIN' && \
    cmake --build build --target whisper-cli -j"$(nproc)" && \
    mkdir -p /out && \
    cp build/bin/whisper-cli /out/ && \
    find build -name '*.so*' -exec cp -a {} /out/ \;
RUN curl -fsSL -o /out/ggml-small-q5_1.bin \
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_MODEL_REV}/ggml-small-q5_1.bin" && \
    echo "${WHISPER_MODEL_SHA256}  /out/ggml-small-q5_1.bin" | sha256sum -c -

# ==========================================
# 1. BASE: shared environment (Alpine + FFmpeg + libc6)
# ==========================================
FROM node:26.10.0-alpine AS base
# FFmpeg and the compatibility libraries the worker needs.
# mkvtoolnix: mkvmerge for the final remux (see src/ffmpeg/runner.ts).
RUN apk add --no-cache ffmpeg mkvtoolnix libc6-compat
# ffsubsync: python3 and py3-numpy come from apk so numpy is never compiled;
# the build tools live in a virtual package removed in the same layer.
RUN apk add --no-cache python3 py3-pip py3-numpy && \
    apk add --no-cache --virtual .ffsubsync-build build-base python3-dev && \
    pip install --no-cache-dir --break-system-packages ffsubsync==0.5.1 && \
    apk del .ffsubsync-build
# whisper-cli, its shared libraries and the model (see the whisper stage).
RUN apk add --no-cache libstdc++ libgomp
COPY --from=whisper /out/ /opt/whisper/
ENV PATH="/opt/whisper:${PATH}"
WORKDIR /app

# ==========================================
# 2. DEV: local development stage
# ==========================================
FROM base AS dev
ENV NODE_ENV=development
# See the matching comment in services/api/Dockerfile: a safety net for when
# /app has no docker-compose.dev.yaml bind mount over it.
RUN chown node:node /app
CMD ["sh", "-c", "if [ ! -d node_modules ]; then npm install; fi && npm run dev"]

# ==========================================
# 3. BUILDER: compiles TypeScript to dist/ (this stage is never published)
# ==========================================
FROM base AS builder
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ==========================================
# 4. PROD: final production image
# ==========================================
FROM base AS prod
ENV NODE_ENV=production

# Create a non-root user, for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 workerjs

# Copy the dependency manifests
COPY package*.json ./

# Install production dependencies only (no devDependencies)
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copy only what the builder stage compiled, never the source or the
# development node_modules (a reproducible image that does not depend on
# whatever is on the host).
COPY --from=builder --chown=workerjs:nodejs /app/dist ./dist

USER workerjs

# dist/index.js was compiled by the build, not inherited from the context.
CMD ["node", "dist/index.js"]