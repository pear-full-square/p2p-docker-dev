# Phase 0.1 — minimal Bare node image.
# node:* base is only here for npm (to install the Bare runtime); the app runs on Bare, not Node.
FROM node:22-slim
RUN npm install -g bare
WORKDIR /app
COPY hello.js .
CMD ["bare", "hello.js"]
