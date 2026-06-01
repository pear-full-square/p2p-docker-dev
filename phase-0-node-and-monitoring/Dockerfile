# The Bare runtime on a minimal glibc base, no Node.
#
# The `node` stage exists only to fetch the Bare runtime via npm; nothing from
# Node ships in the final image. The Bare linux-x64 binary is glibc-dynamic
# (needs libc/libm/libstdc++/libgcc), so the runtime base is distroless **cc**
# (glibc + libstdc++), not scratch/busybox/alpine. The binary itself is ~94MB
# (it embeds a JS engine) — that's the size floor for the prebuilt runtime.

FROM node:22-slim AS bare-runtime
RUN npm install -g bare

FROM gcr.io/distroless/cc-debian12
COPY --from=bare-runtime --chmod=0755 \
  /usr/local/lib/node_modules/bare/node_modules/bare-runtime-linux-x64/bin/bare \
  /usr/local/bin/bare
WORKDIR /app
COPY node.js .
ENTRYPOINT ["/usr/local/bin/bare"]
CMD ["node.js"]
