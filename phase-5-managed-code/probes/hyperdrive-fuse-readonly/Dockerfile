# Probe image: read-only FUSE mount over Hyperdrive v11.
# FUSE requires kernel access — run with: --cap-add SYS_ADMIN --device /dev/fuse
# Uses the full base image (not distroless) for FUSE support.
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
  libatomic1 fuse libfuse-dev build-essential python3 pkg-config \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g bare
WORKDIR /app
COPY package.json .
RUN npm install
COPY probe.mjs interactive.mjs .

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
  libatomic1 fuse \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/probe.mjs /app/interactive.mjs ./
ENTRYPOINT ["node"]
CMD ["probe.mjs"]
