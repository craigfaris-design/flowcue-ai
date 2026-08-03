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

# TLS is expected to be terminated by the platform's load balancer/reverse
# proxy in production (Fly.io, Render, etc. all do this) -- leave HTTPS unset
# so the server speaks plain HTTP on PORT behind it, rather than serving a
# self-signed cert (see src/index.ts, which self-signs only for LAN dev/beta
# testing where there's no proxy in front of it).
EXPOSE 4000
CMD ["node", "dist/index.js"]
