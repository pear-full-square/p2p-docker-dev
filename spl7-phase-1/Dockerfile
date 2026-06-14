FROM node:22
RUN apt-get update && apt-get install -y --no-install-recommends \
      libatomic1 libfuse-dev fuse3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json .
RUN npm install
COPY fuse/package.json ./fuse/
RUN cd fuse && npm install
COPY platform/ ./platform/
COPY join/ ./join/
COPY ui/ ./ui/
COPY fuse/ ./fuse/
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
ENTRYPOINT ["./entrypoint.sh"]
