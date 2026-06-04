# Probe image: isomorphic-git over Hyperdrive storage via the hyperdrive-fs adapter.
# Compares git operations on Hyperdrive against bare-fs (the oracle).
# Needs libatomic for RocksDB (corestore's storage backend).
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 && rm -rf /var/lib/apt/lists/*
RUN npm install -g bare
WORKDIR /app
COPY package.json .
RUN npm install
COPY probe.mjs hyperdrive-fs.mjs .

FROM gcr.io/distroless/cc-debian12
COPY --from=build --chmod=0755 \
  /usr/local/lib/node_modules/bare/node_modules/bare-runtime-linux-x64/bin/bare \
  /usr/local/bin/bare
COPY --from=build /usr/lib/x86_64-linux-gnu/libatomic.so.1 /usr/lib/x86_64-linux-gnu/libatomic.so.1
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/probe.mjs /app/hyperdrive-fs.mjs ./
ENTRYPOINT ["/usr/local/bin/bare"]
CMD ["probe.mjs"]
