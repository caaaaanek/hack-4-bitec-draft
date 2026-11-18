# frontend-proto: React (Vite) збирається в dist/ і віддається nginx без root, /api проксіюється на бекенд.
# Шрифт Onest уже у збірці (src/assets/fonts), тож образу не потрібен інтернет після npm ci.
FROM node:22-slim AS build
WORKDIR /a
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
ENV BACKEND_URL=http://backend:8000
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /a/dist/ /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
