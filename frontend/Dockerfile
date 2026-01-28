# Stage 1: Build the app
FROM node:20-bookworm-slim as build

WORKDIR /app

# Copy package files
COPY frontend/package.json frontend/package-lock.json* ./

# Install dependencies
RUN npm install

# Copy source code
COPY frontend/ ./

# Build the app
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:1.27-alpine

# Install brotli module for better compression
RUN apk add --no-cache nginx-mod-http-brotli

# Copy custom nginx config (FIXES SPA routing + adds compression)
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Clear default nginx files
RUN rm -rf /usr/share/nginx/html/*

# Copy built app
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]