# Agent Hive — production image
# Needs: node >= 22.5 (node:sqlite), git (clone/commit), gh (PRs), ssh (git@github.com).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx -p typescript tsc
COPY ui ./ui
RUN cd ui && npm ci && npx vite build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      git openssh-client ca-certificates curl \
    && (type -p wget >/dev/null || apt-get install -y wget) \
    && mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/ui/dist ./ui/dist
COPY public ./public
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Durable store + workspace
ENV HIVE_DB_PATH=/data/hive.db \
    WORKSPACE=/tmp/hive-workspace \
    PORT=8080
VOLUME /data

# Trust github.com host key so git@ clones work non-interactively.
RUN mkdir -p /root/.ssh && ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["/docker-entrypoint.sh"]
