FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY web ./web
COPY scripts ./scripts
COPY drizzle ./drizzle
COPY .openai/hosting.json ./.openai/hosting.json
RUN node scripts/build.mjs
CMD ["node", "scripts/railway.mjs"]
