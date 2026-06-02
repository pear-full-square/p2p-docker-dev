# The Bare runtime + the app's bundled deps on a minimal glibc base, no Node.
#
# Phase 5 carries three stacks: the swarm (registry), the AVRO RPC forks (avsc,
# avsc-rpc — git-cloned, npm's git-dep handling for these is fragile), and the
# storage stack (corestore/hyperdrive — first-party Pear-native, registry, no fork).
# corestore's rocksdb-native addon needs libatomic.so.1, absent from distroless-cc,
# so it is installed here and copied into the runtime image (see the probe).
# Builder is full node:22 (has git); discarded, so the final image stays Node-free.
FROM node:22 AS build
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 && rm -rf /var/lib/apt/lists/*
RUN npm install -g bare
WORKDIR /app
COPY package.json .
RUN npm install
RUN git clone --depth 1 https://github.com/bare-for-pear/avsc.git     node_modules/avsc \
 && git clone --depth 1 https://github.com/bare-for-pear/avsc-rpc.git node_modules/avsc-rpc \
 && rm -rf node_modules/avsc/.git node_modules/avsc-rpc/.git
COPY bootstrap.js manager.js worker.js client.js log.js channel.js assignments.json ./
COPY roles ./roles

FROM gcr.io/distroless/cc-debian12
COPY --from=build --chmod=0755 \
  /usr/local/lib/node_modules/bare/node_modules/bare-runtime-linux-x64/bin/bare \
  /usr/local/bin/bare
COPY --from=build /usr/lib/x86_64-linux-gnu/libatomic.so.1 /usr/lib/x86_64-linux-gnu/libatomic.so.1
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/bootstrap.js /app/manager.js /app/worker.js /app/client.js /app/log.js /app/channel.js /app/assignments.json ./
COPY --from=build /app/roles ./roles
ENTRYPOINT ["/usr/local/bin/bare"]
CMD ["manager.js"]
