FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NODE_OPTIONS=--max-old-space-size=1400
WORKDIR /app

RUN npm install --global pnpm@11.16.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build:postgres && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    XINBAN_RUNTIME=node-postgres \
    HOST=0.0.0.0 \
    PORT=3000 \
    NODE_OPTIONS=--max-old-space-size=512
WORKDIR /app

RUN groupadd --system --gid 10001 xinban \
    && useradd --system --uid 10001 --gid xinban --home-dir /app xinban
COPY --from=build --chown=xinban:xinban /app/node_modules ./node_modules
COPY --from=build --chown=xinban:xinban /app/dist ./dist
COPY --from=build --chown=xinban:xinban /app/package.json ./package.json
COPY --from=build --chown=xinban:xinban /app/scripts/start-postgres.mjs ./scripts/start-postgres.mjs
COPY --from=build --chown=xinban:xinban /app/scripts/migrate-postgres.mjs ./scripts/migrate-postgres.mjs
COPY --from=build --chown=xinban:xinban /app/postgres ./postgres

USER xinban
EXPOSE 3000
CMD ["node", "--conditions=react-server", "scripts/start-postgres.mjs"]
