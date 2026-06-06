# Node container — general-purpose swarm membership manager.
# Keeps both bare (swarm node process) and node.js (FUSE mount).
# FUSE needs: fuse-native (node-gyp), libfuse-dev, /dev/fuse at runtime.
FROM node:22
RUN apt-get update && apt-get install -y --no-install-recommends \
      libatomic1 libfuse-dev fuse3 \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g bare
WORKDIR /app
COPY package.json .
RUN npm install
COPY fuse/package.json ./fuse/
RUN cd fuse && npm install
COPY seed/ ./seed/
COPY peer/ ./peer/
COPY ui/ ./ui/
COPY fuse/ ./fuse/
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
ENTRYPOINT ["./entrypoint.sh"]
