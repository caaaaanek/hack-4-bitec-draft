# frontend-proto: одна сторінка (index.html) через nginx без root, /api проксіюється на бекенд.
# Шрифт Onest вбудовується локально замість Google Fonts (закритий контур).
FROM node:22-alpine AS assets
WORKDIR /a
RUN npm init -y >/dev/null && npm install --no-audit --no-fund @fontsource-variable/onest@5 >/dev/null
COPY index.html deploy/onest.css ./
RUN mkdir -p out/fonts \
 && cp node_modules/@fontsource-variable/onest/files/onest-cyrillic-wght-normal.woff2 \
       node_modules/@fontsource-variable/onest/files/onest-latin-wght-normal.woff2 onest.css out/fonts/ \
 && sed -e '/fonts.googleapis.com/d' -e '/fonts.gstatic.com/d' \
        -e 's#</head>#<link rel="stylesheet" href="/fonts/onest.css">\n</head>#' index.html > out/index.html

FROM nginxinc/nginx-unprivileged:1.27-alpine
ENV BACKEND_URL=http://backend:8000
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=assets /a/out/ /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8080/fonts/onest.css >/dev/null || exit 1
