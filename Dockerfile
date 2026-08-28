FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# va-driver-all brings the Intel iHD/i965 VA-API drivers so ffmpeg can reach the
# iGPU when /dev/dri is mapped into the container; vainfo is kept for diagnosis.
RUN apt-get update \
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

RUN pnpm install --frozen-lockfile

COPY . .

ENV NODE_ENV=production \
    SERVER_PORT=4141

RUN pnpm build

EXPOSE 4141

CMD ["pnpm", "start"]
