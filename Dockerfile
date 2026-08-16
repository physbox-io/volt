# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy the entire project context
COPY . .

# Build the engine dependency
WORKDIR /app/ngspice-wasm/EEcircuit-engine
RUN npm install
RUN npm run build

# Build the frontend application
WORKDIR /app
RUN npm install
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
