ARG NODE_VERSION=22
FROM --platform=$TARGETPLATFORM node:${NODE_VERSION}-bookworm-slim


WORKDIR /usr/src/app

# install deps first for cache
COPY package*.json ./
ENV NODE_ENV=production
RUN npm ci --omit=dev

# then app code
COPY . .

EXPOSE 80
CMD ["node", "index.js", "80"]