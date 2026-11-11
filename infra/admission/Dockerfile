FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS runtime
WORKDIR /yac
COPY infra/admission/runtime/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY scripts/admission/ scripts/admission/
COPY scripts/faucet-server.ts scripts/faucet-server.ts
COPY packages/shared/ packages/shared/
COPY infra/admission/snapshot.mjs infra/admission/snapshot.mjs
COPY infra/admission/restore.mjs infra/admission/restore.mjs
RUN mkdir /data && chown node:node /data
USER node
ENV YAC_ADMISSION_ENABLED=false YAC_ADMISSION_CONFIG=/run/secrets/admission.json
ENTRYPOINT ["node", "--import", "tsx", "scripts/faucet-server.ts"]

FROM runtime AS rehearsal
COPY infra/admission/rehearsal-server.ts infra/admission/rehearsal-server.ts
ENTRYPOINT ["node", "--import", "tsx", "infra/admission/rehearsal-server.ts"]

# Default build must never select the fixture server.
FROM runtime AS production
