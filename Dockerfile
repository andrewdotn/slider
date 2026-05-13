FROM node:24.15.0-bookworm-slim

# node-pty is a native module — its yarn4 prebuilds need to be rebuilt/installed
# with build tools available, and `python3`/`make`/`g++` cover the node-gyp path
# if the prebuild is missing for the container's architecture.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare yarn@4.14.1 --activate

WORKDIR /app

# Install dependencies first so this layer caches when source changes.
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

# Source is bind-mounted at runtime via docker-compose, but copy it in too so
# the image is runnable on its own.
COPY . .

EXPOSE 3000

CMD ["node", "--experimental-strip-types", "server.ts", "--port", "3000", "--base-dir", "/slides"]
