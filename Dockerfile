FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/game-core/package.json packages/game-core/tsconfig.json ./packages/game-core/
COPY packages/game-core/src ./packages/game-core/src
COPY packages/protocol/package.json packages/protocol/tsconfig.json ./packages/protocol/
COPY packages/protocol/src ./packages/protocol/src
COPY apps/game-server/package.json apps/game-server/tsconfig.json ./apps/game-server/
COPY apps/game-server/src ./apps/game-server/src
COPY apps/game-server/migrations ./apps/game-server/migrations
RUN npm ci --ignore-scripts && npm --workspace @exploding-kitty/game-core run build \
  && npm --workspace @exploding-kitty/protocol run build \
  && npm --workspace @exploding-kitty/game-server run build \
  && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
USER node
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/packages/game-core ./packages/game-core
COPY --chown=node:node --from=build /app/packages/protocol ./packages/protocol
COPY --chown=node:node --from=build /app/apps/game-server ./apps/game-server
WORKDIR /app/apps/game-server
EXPOSE 3000
CMD ["sh", "-c", "node dist/persistence/migrate.js && exec node dist/main.js"]
