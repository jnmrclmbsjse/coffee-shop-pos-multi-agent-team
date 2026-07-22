FROM node:24-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/shared packages/shared
RUN pnpm --filter @coffee-shop/api... build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace/apps/api
COPY --from=build /workspace/node_modules /workspace/node_modules
COPY --from=build /workspace/packages/shared /workspace/packages/shared
COPY --from=build /workspace/apps/api/node_modules ./node_modules
COPY --from=build /workspace/apps/api/dist ./dist
COPY --from=build /workspace/apps/api/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
