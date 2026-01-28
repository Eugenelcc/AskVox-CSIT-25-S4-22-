# Stage 1: Build
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Upgrade npm to avoid optional-deps bug (rollup native package)
RUN npm i -g npm@11.8.0

# Install deps first (better caching)
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --include=optional

# Copy source + build
COPY frontend/ ./
RUN npm run build

# Stage 2: Serve static with nginx
FROM nginx:1.27-alpine
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
