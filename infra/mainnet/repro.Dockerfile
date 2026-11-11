# Cross-environment check; compiler/cache inputs are mounted separately and recorded.
FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates pkg-config libssl-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/platform/rust/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ENV CARGO_HOME="/work/cargo" CARGO_TARGET_DIR="/work/target"
WORKDIR /work/source
