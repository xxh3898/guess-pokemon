FROM scratch

ARG REVISION

LABEL org.opencontainers.image.source="https://github.com/xxh3898/guess-pokemon"
LABEL org.opencontainers.image.revision="${REVISION}"
LABEL io.chochiho.runtime-config.project="guess-pokemon"

COPY compose.production.yaml /runtime/compose.yaml
COPY infra/nginx/cloudflare-edge-real-ip.conf /runtime/infra/nginx/cloudflare-edge-real-ip.conf

CMD ["/runtime/compose.yaml"]
