# Bare runtime + Holepunch stack on a minimal glibc base.
# Same build pattern as phase 5: node:22 builder (for npm + native addons),
# distroless runtime with just the bare binary + libatomic.
FROM node:22 AS build
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 && rm -rf /var/lib/apt/lists/*
RUN npm install -g bare
WORKDIR /app
COPY package.json .
RUN npm install
COPY seed/ ./seed/
COPY peer/ ./peer/
COPY ui/ ./ui/

FROM gcr.io/distroless/cc-debian12
COPY --from=build --chmod=0755 \
  /usr/local/lib/node_modules/bare/node_modules/bare-runtime-linux-x64/bin/bare \
  /usr/local/bin/bare
COPY --from=build /usr/lib/x86_64-linux-gnu/libatomic.so.1 /usr/lib/x86_64-linux-gnu/libatomic.so.1
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/seed/ ./seed/
COPY --from=build /app/peer/ ./peer/
COPY --from=build /app/ui/ ./ui/
ENTRYPOINT ["/usr/local/bin/bare"]
