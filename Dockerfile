FROM node:22.23.4-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
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
