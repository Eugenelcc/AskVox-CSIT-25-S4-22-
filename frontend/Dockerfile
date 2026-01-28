# Stage 1: Build frontend (Debian-based to avoid Rollup musl issues)
FROM node:20-bookworm-slim as build
WORKDIR /app

# Copy package files from the frontend folder (because build context is repo root)
COPY frontend/package.json frontend/package-lock.json* ./

# Install deps (force optional deps so Rollup native package is installed)
RUN if [ -f package-lock.json ]; then npm ci --include=optional; else npm install --include=optional; fi

# Copy the rest of the frontend app
COPY frontend/ ./

# Build the app
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:1.27-alpine
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
