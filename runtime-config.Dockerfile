FROM scratch

ARG REVISION

LABEL org.opencontainers.image.source="https://github.com/xxh3898/guess-pokemon"
LABEL org.opencontainers.image.revision="${REVISION}"
LABEL io.chochiho.runtime-config.project="guess-pokemon"

COPY compose.production.yaml /runtime/compose.yaml
COPY infra/nginx/cloudflare-edge-real-ip.conf /runtime/infra/nginx/cloudflare-edge-real-ip.conf
COPY --chmod=0700 scripts/deploy-guess-pokemon.sh /runtime/scripts/deploy-guess-pokemon.sh
COPY --chmod=0700 scripts/backup-production-db.sh /runtime/scripts/backup-guess-pokemon.sh

CMD ["/runtime/compose.yaml"]
