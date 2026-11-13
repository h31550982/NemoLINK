FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips the postinstall `quasar prepare` (needs sources not yet
# copied); `quasar build` regenerates .quasar itself
RUN npm ci --no-fund --no-audit --ignore-scripts
COPY . .
RUN npx quasar build

FROM nginx:alpine
COPY --from=build /app/dist/spa /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
