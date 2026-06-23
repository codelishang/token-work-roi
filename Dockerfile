FROM node:24-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY config ./config
COPY public ./public
COPY data/.gitkeep ./data/.gitkeep
COPY data/official-pricing.json ./data/official-pricing.json
COPY index.html vite.config.js ./
RUN npm run build && npm prune --omit=dev

ENV PORT=4173
ENV HOST=127.0.0.1
EXPOSE 4173

CMD ["node", "src/server.mjs"]
