# Probe image: isomorphic-git (pure JS) + bare-fs, run under Bare on the cluster's
# distroless-cc base. No native addons, no libatomic, no system git binary, no fork.
FROM node:22-slim AS build
RUN npm install -g bare
WORKDIR /app
COPY package.json .
RUN npm install
COPY probe.mjs .

FROM gcr.io/distroless/cc-debian12
COPY --from=build --chmod=0755 \
  /usr/local/lib/node_modules/bare/node_modules/bare-runtime-linux-x64/bin/bare \
  /usr/local/bin/bare
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/probe.mjs ./
ENTRYPOINT ["/usr/local/bin/bare"]
CMD ["probe.mjs"]
