# Stage 1: Build frontend (Debian-based, avoids Rollup musl optional dep issues)
FROM node:20-bookworm-slim as build
WORKDIR /app

# Install dependencies first for better caching
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

# Copy rest of the application
COPY frontend/ ./

# Build the app
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:1.27-alpine
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
