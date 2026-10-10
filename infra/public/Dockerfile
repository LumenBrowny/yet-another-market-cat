FROM node:24-bookworm-slim AS node
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY server/ server/
COPY protocol/ protocol/
RUN dotnet publish server/YetAnotherCat.Api -c Release -o /out -m:1 /nodeReuse:false

FROM mcr.microsoft.com/dotnet/aspnet:10.0
RUN apt-get update && apt-get install -y --no-install-recommends libgssapi-krb5-2 && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
WORKDIR /yac
COPY infra/public/runtime/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY scripts/ scripts/
COPY packages/shared/ packages/shared/
COPY protocol/ protocol/
COPY --from=build /out/ server/YetAnotherCat.Api/
RUN mkdir -p /yac/.dev && chown -R 1654:1654 /yac
USER 1654
ENV YAC_ROOT=/yac ASPNETCORE_URLS=http://+:8080 ASPNETCORE_ENVIRONMENT=Production
WORKDIR /yac/server/YetAnotherCat.Api
ENTRYPOINT ["dotnet", "YetAnotherCat.Api.dll"]
