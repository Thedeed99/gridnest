FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
COPY src/daily-recap.js ./src/daily-recap.js
COPY src/solar-meter.js ./src/solar-meter.js
COPY src/energy-statistics.js ./src/energy-statistics.js
COPY public/index.html ./public/index.html
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ARG BUILD_VERSION=1.0.2
LABEL io.hass.name="Gridnest" \
      io.hass.description="Lokale energie- en comfortmonitor" \
      io.hass.version="${BUILD_VERSION}" \
      io.hass.type="addon" \
      io.hass.arch="amd64|aarch64"
RUN apk add --no-cache su-exec tzdata
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data HOST=0.0.0.0 TZ=Europe/Amsterdam
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node src ./src
COPY run.sh /run.sh
RUN sed -i 's/\r$//' /run.sh && chmod 755 /run.sh
EXPOSE 8080
ENTRYPOINT ["/run.sh"]