# Local NEMO mock for the compose stack: Prism serves answers generated from
# the vendored Declarant API spec (mounted at /openapi by docker-compose.yml).
FROM node:22-alpine
WORKDIR /mock
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
# The spec as live NEMO behaves (live-spec.mjs); a fresh visit id per
# created call (visit-ids.mjs, a proxy on 4010 in front of Prism on 4011)
COPY live-spec.mjs visit-ids.mjs ./
EXPOSE 4010
CMD ["sh", "-c", "node live-spec.mjs && (node visit-ids.mjs &) && exec npx prism mock --host 127.0.0.1 --port 4011 /mock/declarant.live.json"]
