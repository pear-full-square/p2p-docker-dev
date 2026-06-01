# The Bare runtime + the app's bundled deps on a minimal glibc base, no Node.
#
# Deps are installed via npm in the build stage and copied as node_modules —
# absorbed at build time (see the roadmap invariant: the app owns all runtime
# code, nothing is pulled at runtime). The `node` stage exists only to fetch the
# Bare runtime and the deps; nothing from Node ships in the final image. The Bare
# linux-x64 binary is glibc-dynamic, so the runtime base is distroless **cc**.

FROM node:22-slim AS build
RUN npm install -g bare
WORKDIR /app
COPY package.json .
RUN npm install
COPY node.js bootstrap.js .

FROM gcr.io/distroless/cc-debian12
COPY --from=build --chmod=0755 \
  /usr/local/lib/node_modules/bare/node_modules/bare-runtime-linux-x64/bin/bare \
  /usr/local/bin/bare
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/node.js /app/bootstrap.js ./
ENTRYPOINT ["/usr/local/bin/bare"]
CMD ["node.js"]
