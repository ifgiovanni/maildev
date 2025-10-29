# Base
FROM node:18-alpine as base
RUN apk add --no-cache tzdata
ENV NODE_ENV production
ENV TZ UTC

# Build
FROM base as build
WORKDIR /root
COPY package*.json ./
RUN npm install \
  && npm prune \
  && npm cache clean --force

# Prod
FROM base as prod
USER node
WORKDIR /home/node
COPY --chown=node:node . /home/node
COPY --chown=node:node --from=build /root/node_modules /home/node/node_modules
EXPOSE 80 25
ENV MAILDEV_WEB_PORT 80
ENV MAILDEV_SMTP_PORT 25
ENTRYPOINT ["bin/maildev"] 
HEALTHCHECK --interval=10s --timeout=1s \
  CMD wget -O - http://localhost:${MAILDEV_WEB_PORT}${MAILDEV_BASE_PATHNAME}/healthz || exit 1
