# frontend-proto: React (Vite) збирається в dist/ і віддається nginx без root, /api проксіюється на бекенд.
# Шрифт Onest вбудовується локально замість Google Fonts (закритий контур).
FROM node:22-slim AS build
WORKDIR /a
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build \
 && npm install --no-save --no-audit --no-fund @fontsource-variable/onest@5 >/dev/null \
 && mkdir -p dist/fonts \
 && cp node_modules/@fontsource-variable/onest/files/onest-cyrillic-wght-normal.woff2 \
       node_modules/@fontsource-variable/onest/files/onest-latin-wght-normal.woff2 dist/fonts/
COPY deploy/onest.css dist/fonts/
RUN sed -i -e '/fonts.googleapis.com/d' -e '/fonts.gstatic.com/d' \
        -e 's#</head>#<link rel="stylesheet" href="/fonts/onest.css">\n</head>#' dist/index.html

FROM nginxinc/nginx-unprivileged:1.27-alpine
ENV BACKEND_URL=http://backend:8000
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /a/dist/ /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/fonts/onest.css >/dev/null || exit 1
