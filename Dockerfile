FROM node:22-alpine

WORKDIR /app

COPY --chown=node:node . .

ENV NODE_ENV=production
ENV PORT=5173
ENV BAYNAT_DATA_FILE=/data/baynat.json

RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 5173
VOLUME ["/data"]

CMD ["npm", "start"]
