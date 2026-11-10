FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium xvfb pulseaudio ffmpeg ca-certificates fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm install --omit=dev playwright-core@1.56.1
COPY worker.mjs proxy.mjs policy.mjs sources.mjs encoding.mjs health.mjs ./
RUN mkdir /data && chown node:node /data
USER node
ENV DISPLAY=:99 HOME=/home/node
CMD ["node", "worker.mjs"]
