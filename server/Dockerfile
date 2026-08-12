# Multi-stage build: compile TypeScript, then ship only the compiled
# output + production deps in the final image.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# migrate.ts resolves migrations relative to its own compiled location
# (dist/migrate.js's __dirname -> dist/migrations) -- tsc only compiles
# .ts files, so the raw .sql files never end up in dist/ on their own.
# Found the hard way: this went unnoticed as long as migrations only ever
# ran manually via `npm run migrate` (tsx against src/ directly, never
# through this image) -- surfaced once index.ts started running them on
# every boot instead (Render's free tier has no Shell/One-Off Jobs to run
# the CLI script separately).
COPY --from=build /app/src/migrations ./dist/migrations

# TLS is expected to be terminated by the platform's load balancer/reverse
# proxy in production (Fly.io, Render, etc. all do this) -- leave HTTPS unset
# so the server speaks plain HTTP on PORT behind it, rather than serving a
# self-signed cert (see src/index.ts, which self-signs only for LAN dev/beta
# testing where there's no proxy in front of it).
EXPOSE 4000
CMD ["node", "dist/index.js"]
