# The Bare runtime + bundled deps on a minimal glibc base, no Node.
#
# Pub/sub needs no RPC layer, so this is the lighter stack — just the Hyperswarm
# deps via npm, no avsc forks to clone. The `node` builder stage exists only to
# fetch Bare + the deps; nothing from Node ships in the final distroless image.

FROM node:22-slim AS build
RUN npm install -g bare
WORKDIR /app
COPY package.json .
RUN npm install
COPY node.js bootstrap.js log.js .

FROM gcr.io/distroless/cc-debian12
COPY --from=build --chmod=0755 \
  /usr/local/lib/node_modules/bare/node_modules/bare-runtime-linux-x64/bin/bare \
  /usr/local/bin/bare
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/node.js /app/bootstrap.js /app/log.js ./
ENTRYPOINT ["/usr/local/bin/bare"]
CMD ["node.js"]
