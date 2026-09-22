# ---- Stage 1: build the Vue frontend ----
FROM node:22-alpine AS frontend-builder
WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- Stage 2: install backend dependencies ----
FROM node:22-alpine AS server-deps
WORKDIR /app
# better-sqlite3 usually installs from a prebuilt binary, but Alpine (musl) doesn't
# always have one published for every Node/arch combo. Installing a build toolchain
# here means npm falls back to compiling from source instead of failing outright.
RUN apk add --no-cache python3 make g++
COPY server/package.json ./
RUN npm install --omit=dev

# ---- Stage 3: final runtime image — ONE service serving both the API and the static frontend ----
FROM node:22-alpine AS runtime
WORKDIR /app

COPY --from=server-deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/index.js ./
COPY server/collabServer.js ./
COPY --from=frontend-builder /app/dist ./public

ENV PORT=80
ENV DATA_DIR=/data
ENV STATIC_DIR=/app/public
VOLUME ["/data"]
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ || exit 1

CMD ["node", "index.js"]
