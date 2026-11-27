# Argus Sentinel on a Hugging Face Space (Docker SDK).
# The Space holds only this file and README.md. The build clones the public
# repo, so "Factory rebuild" in the Space settings deploys the latest main.
# Secrets and variables are set in the Space settings, never in this file.
FROM node:24-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Changes whenever main moves, so the clone below is never served from cache.
ADD https://api.github.com/repos/ELLA0VICTOR/argus/git/refs/heads/main /tmp/main-ref.json
RUN git clone --depth 1 --branch main https://github.com/ELLA0VICTOR/argus.git /srv/argus

WORKDIR /srv/argus/sentinel
RUN npm ci --omit=dev

ENV NODE_ENV=production \
    PORT=7860 \
    TRUST_PROXY_HOPS=1

# Hugging Face runs containers as uid 1000, which is "node" in this image.
USER node
EXPOSE 7860
CMD ["node", "src/server.ts"]
