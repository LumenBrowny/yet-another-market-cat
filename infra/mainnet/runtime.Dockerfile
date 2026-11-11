ARG API_IMAGE
FROM ${API_IMAGE}
# Mainnet client PDAs are derived from this candidate's IDL, never the devnet IDL.
COPY runtime-idl.json /yac/packages/shared/src/idl.json
