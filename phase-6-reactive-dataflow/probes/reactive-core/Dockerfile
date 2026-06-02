# Probe image: hypercore + b4a under Bare on the cluster's distroless-cc base.
# corestore's RocksDB backend isn't used here (raw hypercore for predictable keys),
# but hypercore-storage still pulls rocksdb-native -> needs libatomic on distroless.
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 && rm -rf /var/lib/apt/lists/*
RUN npm install -g bare
WORKDIR /app
COPY package.json .
RUN npm install
COPY probe.js .

FROM gcr.io/distroless/cc-debian12
COPY --from=build --chmod=0755 \
  /usr/local/lib/node_modules/bare/node_modules/bare-runtime-linux-x64/bin/bare \
  /usr/local/bin/bare
COPY --from=build /usr/lib/x86_64-linux-gnu/libatomic.so.1 /usr/lib/x86_64-linux-gnu/libatomic.so.1
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/probe.js ./
ENTRYPOINT ["/usr/local/bin/bare"]
CMD ["probe.js"]
