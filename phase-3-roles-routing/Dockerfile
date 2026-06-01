# The Bare runtime + the app's bundled deps on a minimal glibc base, no Node.
#
# Registry deps via npm; the AVRO RPC forks (avsc, avsc-rpc) are cloned via
# anonymous https into node_modules as siblings (npm's git-dep handling for these
# non-registry forks is fragile). Builder is full node:22 (has git); discarded in
# the multi-stage build, so the final image stays Node-free.

FROM node:22 AS build
RUN npm install -g bare
WORKDIR /app
COPY package.json .
RUN npm install
RUN git clone --depth 1 https://github.com/bare-for-pear/avsc.git     node_modules/avsc \
 && git clone --depth 1 https://github.com/bare-for-pear/avsc-rpc.git node_modules/avsc-rpc \
 && rm -rf node_modules/avsc/.git node_modules/avsc-rpc/.git
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
