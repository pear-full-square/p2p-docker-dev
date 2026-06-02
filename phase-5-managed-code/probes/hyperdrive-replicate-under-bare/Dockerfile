# Probe image: the Holepunch STORAGE stack (corestore/hyperdrive) installed via
# npm, copied as node_modules, run under Bare on the cluster's distroless-cc base.
# Self-contained build context — re-runnable in isolation. Unlike the avsc forks,
# these are first-party Pear-native modules and need no git clone / barification.
FROM node:22-slim AS build
# corestore's storage backend (rocksdb-native) needs libatomic.so.1, which the
# distroless-cc base lacks (the swarm/RPC phases never pulled it in). Install it
# here so it can be copied into the runtime image below.
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 && rm -rf /var/lib/apt/lists/*
RUN npm install -g bare
WORKDIR /app
COPY package.json .
RUN npm install
COPY probe.js api.js replicate.js exec.js .

FROM gcr.io/distroless/cc-debian12
COPY --from=build --chmod=0755 \
  /usr/local/lib/node_modules/bare/node_modules/bare-runtime-linux-x64/bin/bare \
  /usr/local/bin/bare
COPY --from=build /usr/lib/x86_64-linux-gnu/libatomic.so.1 /usr/lib/x86_64-linux-gnu/libatomic.so.1
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/probe.js /app/api.js /app/replicate.js /app/exec.js ./
ENTRYPOINT ["/usr/local/bin/bare"]
CMD ["probe.js"]
