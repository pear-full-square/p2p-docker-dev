# Probe image: just the swarm stack (no storage, no avsc) under Bare on the
# distroless-cc base. Self-contained — connect-by-key.js spins its own bootstrap.
FROM node:22-slim AS build
RUN npm install -g bare
WORKDIR /app
COPY package.json .
RUN npm install
COPY connect-by-key.js .

FROM gcr.io/distroless/cc-debian12
COPY --from=build --chmod=0755 \
  /usr/local/lib/node_modules/bare/node_modules/bare-runtime-linux-x64/bin/bare \
  /usr/local/bin/bare
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/connect-by-key.js ./
ENTRYPOINT ["/usr/local/bin/bare"]
CMD ["connect-by-key.js"]
