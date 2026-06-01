# Probe image: avsc + avsc-rpc (bare-for-pear forks) loaded under Bare.
#
# npm's git-dep handling for these non-registry forks is fragile (normalises
# git+https github URLs to ssh, and hits cacache tmp collisions), so we clone
# them via anonymous https directly into node_modules — their registry deps
# (streamx, bare-*) are npm-installed at top level as siblings. The relative
# `require('../avsc')` in avsc-rpc resolves to the sibling node_modules/avsc.
# Builder is full node:22 (has git); discarded in the multi-stage build.
FROM node:22 AS build
RUN npm install -g bare
WORKDIR /app
COPY package.json .
RUN npm install
RUN git clone --depth 1 https://github.com/bare-for-pear/avsc.git     node_modules/avsc \
 && git clone --depth 1 https://github.com/bare-for-pear/avsc-rpc.git node_modules/avsc-rpc \
 && rm -rf node_modules/avsc/.git node_modules/avsc-rpc/.git
COPY probe.js .

FROM gcr.io/distroless/cc-debian12
COPY --from=build --chmod=0755 \
  /usr/local/lib/node_modules/bare/node_modules/bare-runtime-linux-x64/bin/bare \
  /usr/local/bin/bare
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/probe.js .
ENTRYPOINT ["/usr/local/bin/bare"]
CMD ["probe.js"]
