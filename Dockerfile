# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy the entire project context
COPY . .

# Needed to install @physbox-io/ui from GitHub Packages (see .npmrc)
ARG GITHUB_TOKEN
ENV GITHUB_TOKEN=$GITHUB_TOKEN

# Build the engine dependency
WORKDIR /app/ngspice-wasm/EEcircuit-engine
RUN npm ci
RUN npm run build

# Build the frontend application
WORKDIR /app
# `ci`, not `install`: the lockfile is what the tests ran against, and the
# shared @physbox-io packages are on a caret range. `npm install` is free to
# resolve a newer minor at build time, so a deploy could ship a version of the
# machine layer nobody had run — quietly, and only in the image.
RUN npm ci
RUN npm run build

# Production stage
FROM nginx:stable-alpine

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 8000
EXPOSE 8000

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
