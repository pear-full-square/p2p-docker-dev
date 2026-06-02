# Probe image: protomux + compact-encoding + the storage stack + a real
# secret-stream, with the avsc-rpc forks git-cloned, run under Bare on the cluster's
# distroless-cc base. libatomic.so.1 for corestore's rocksdb-native (as in the
# hyperdrive probe). Self-contained, re-runnable in isolation.
FROM node:22 AS build
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 && rm -rf /var/lib/apt/lists/*
RUN npm install -g bare
WORKDIR /app
COPY package.json .
RUN npm install
RUN git clone --depth 1 https://github.com/bare-for-pear/avsc.git     node_modules/avsc \
 && git clone --depth 1 https://github.com/bare-for-pear/avsc-rpc.git node_modules/avsc-rpc \
 && rm -rf node_modules/avsc/.git node_modules/avsc-rpc/.git
COPY load.js rpc.js coexist.js .

FROM gcr.io/distroless/cc-debian12
COPY --from=build --chmod=0755 \
  /usr/local/lib/node_modules/bare/node_modules/bare-runtime-linux-x64/bin/bare \
  /usr/local/bin/bare
COPY --from=build /usr/lib/x86_64-linux-gnu/libatomic.so.1 /usr/lib/x86_64-linux-gnu/libatomic.so.1
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/load.js /app/rpc.js /app/coexist.js ./
ENTRYPOINT ["/usr/local/bin/bare"]
CMD ["load.js"]
