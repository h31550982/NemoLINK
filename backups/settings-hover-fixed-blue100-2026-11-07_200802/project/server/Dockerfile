# Build context is the nemolink root (not server/), so the image can carry
# migrations/ — the server applies them at boot (spec 0058), and an image that
# cannot find them refuses to start rather than serve on an unknown schema.
FROM node:22-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json ./
COPY server/vendor ./vendor
RUN npm ci --no-fund --no-audit
COPY server/tsconfig.json server/nest-cli.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server/package.json ./
# Applied at boot, in filename order, under an advisory lock (spec 0058).
COPY migrations ./migrations
EXPOSE 3000
USER node
CMD ["node", "dist/main.js"]
