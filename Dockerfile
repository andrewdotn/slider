FROM node:24.15.0-bookworm-slim

# build tools for node-pty
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        g++ \
        make \
        python3 \
    ;

WORKDIR /app

COPY package.json ./

RUN YARN_VERSION="$(node -e "const p = require('./package.json'); console.log(p.volta.yarn)")" \
    && corepack enable && corepack prepare yarn@$YARN_VERSION --activate

COPY yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

COPY . .

EXPOSE 3000

CMD ["node", "--experimental-strip-types", "server.ts", "--port", "3000", "--base-dir", "/slides"]
