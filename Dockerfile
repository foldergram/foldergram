FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Optional Debian mirror host for builds on networks where deb.debian.org is slow.
# Leave empty to use the default upstream mirror.
ARG APT_MIRROR=""

# va-driver-all brings the Intel iHD/i965 VA-API drivers so ffmpeg can reach the
# iGPU when /dev/dri is mapped into the container; vainfo is kept for diagnosis.
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|deb.debian.org|$APT_MIRROR|g" /etc/apt/sources.list.d/debian.sources; \
    fi \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    va-driver-all \
    vainfo \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json

# Optional npm registry mirror, same rationale as APT_MIRROR.
ARG NPM_REGISTRY=""

RUN if [ -n "$NPM_REGISTRY" ]; then \
      pnpm config set registry "$NPM_REGISTRY"; \
    fi \
  && pnpm install --frozen-lockfile

COPY . .

ENV NODE_ENV=production \
    SERVER_PORT=4141

RUN pnpm build

EXPOSE 4141

CMD ["pnpm", "start"]
