#!/bin/bash

set -Eeuo pipefail

if [[ "${1:-}" == --config ]]; then
  shift 2
fi

command_name="${1:-}"
shift || true

if [[ -n "${FAKE_DOCKER_LOG:-}" ]]; then
  printf '%s %s\n' "${command_name}" "$*" >>"${FAKE_DOCKER_LOG}"
fi

case "${command_name}" in
  login|logout|pull|rm)
    exit 0
    ;;
  create)
    printf 'mock-runtime-config-container\n'
    ;;
  cp)
    destination="$2"
    /bin/mkdir -p "${destination}/infra/nginx"
    if [[ "${FAKE_FAIL_CP:-false}" == true ]]; then
      exit 1
    fi
    /bin/cp "${FAKE_RUNTIME_COMPOSE}" "${destination}/compose.yaml"
    /bin/cp \
      "${FAKE_RUNTIME_REAL_IP}" \
      "${destination}/infra/nginx/cloudflare-edge-real-ip.conf"
    ;;
  image)
    test "$1" = inspect
    shift
    test "$1" = --format
    shift
    format="$1"
    image="$2"
    if [[ "${format}" == *org.opencontainers.image.revision* ]]; then
      case "${image}" in
        *guess-pokemon-runtime-config*)
          printf '%s\n' "${FAKE_CONFIG_REVISION}"
          ;;
        *"${FAKE_REVISION_ONE}"*)
          printf '%s\n' "${FAKE_REVISION_ONE}"
          ;;
        *"${FAKE_REVISION_TWO}"*)
          printf '%s\n' "${FAKE_REVISION_TWO}"
          ;;
        *)
          printf '%s\n' "${FAKE_REVISION_THREE}"
          ;;
      esac
    elif [[ "${format}" == *io.chochiho.runtime-config.project* ]]; then
      printf 'guess-pokemon\n'
    else
      exit 1
    fi
    ;;
  compose)
    arguments=" $* "
    if [[ "${arguments}" == *" --format json "* ]]; then
      compose_file=
      previous_argument=
      for argument in "$@"; do
        if [[ "${previous_argument}" == --file ]]; then
          compose_file="${argument}"
          break
        fi
        previous_argument="${argument}"
      done
      api_image="${FAKE_RENDER_API_IMAGE:-${API_IMAGE}}"
      web_image="${FAKE_RENDER_WEB_IMAGE:-${WEB_IMAGE}}"
      edge_alias="${FAKE_RENDER_EDGE_ALIAS:-guess-pokemon-web}"
      db_image="${FAKE_RENDER_DB_IMAGE:-postgres:18.4-alpine3.24}"
      database_name="${FAKE_RENDER_DATABASE_NAME:-guess_pokemon}"
      ddl_auto="${FAKE_RENDER_DDL_AUTO:-validate}"
      datasource_url="${FAKE_RENDER_DATASOURCE_URL:-jdbc:postgresql://db:5432/${database_name}}"
      real_ip_source="$(
        /usr/bin/dirname "${compose_file}"
      )/infra/nginx/cloudflare-edge-real-ip.conf"
      real_ip_source="${FAKE_RENDER_REAL_IP_SOURCE:-${real_ip_source}}"
      web_healthcheck='{"test":["CMD","wget","-q","-O","/dev/null","http://127.0.0.1/actuator/health/readiness"]}'
      if [[ "${FAKE_DISABLE_WEB_HEALTHCHECK:-false}" == true ]]; then
        web_healthcheck='{"disable":true}'
      fi
      web_profiles='[]'
      if [[ "${FAKE_RENDER_WEB_PROFILE:-false}" == true ]]; then
        web_profiles='["optional"]'
      fi
      web_restart="${FAKE_RENDER_RESTART_POLICY:-unless-stopped}"
      web_scale="${FAKE_RENDER_WEB_SCALE:-1}"
      session_cookie_secure="${FAKE_RENDER_SESSION_COOKIE_SECURE:-true}"
      egress_external="${FAKE_RENDER_EGRESS_EXTERNAL:-false}"
      printf \
        '{"name":"guess-pokemon","services":{"db":{"image":"%s","restart":"unless-stopped","environment":{"POSTGRES_DB":"%s"},"healthcheck":{"test":["CMD-SHELL","pg_isready -U \\\"$${POSTGRES_USER}\\\" -d \\\"$${POSTGRES_DB}\\\""]},"networks":{"application":null},"volumes":[{"type":"volume","source":"postgres-data","target":"/var/lib/postgresql"}]},"api":{"image":"%s","restart":"unless-stopped","environment":{"SPRING_DATASOURCE_URL":"%s","SPRING_JPA_HIBERNATE_DDL_AUTO":"%s","SERVER_FORWARD_HEADERS_STRATEGY":"native","SESSION_COOKIE_SECURE":"%s"},"healthcheck":{"test":["CMD-SHELL","wget -qO- http://127.0.0.1:8080/actuator/health/readiness | grep -q '\''\\\"status\\\":\\\"UP\\\"'\''"]},"networks":{"application":null,"egress":null}},"web":{"image":"%s","restart":"%s","scale":%s,"profiles":%s,"healthcheck":%s,"networks":{"application":null,"edge":{"aliases":["%s"]}},"volumes":[{"type":"bind","source":"%s","target":"/etc/nginx/conf.d/00-cloudflare-real-ip.conf","read_only":true}]}},"networks":{"application":{"internal":true},"egress":{"name":"guess-pokemon_egress","driver":"bridge","external":%s},"edge":{"external":true,"name":"edge"}},"volumes":{"postgres-data":{"name":"guess-pokemon_postgres-data"}}}\n' \
        "${db_image}" \
        "${database_name}" \
        "${api_image}" \
        "${datasource_url}" \
        "${ddl_auto}" \
        "${session_cookie_secure}" \
        "${web_image}" \
        "${web_restart}" \
        "${web_scale}" \
        "${web_profiles}" \
        "${web_healthcheck}" \
        "${edge_alias}" \
        "${real_ip_source}" \
        "${egress_external}"
    elif [[ "${arguments}" == *" ps --status running --services "* ]]; then
      printf 'db\napi\nweb\n'
    elif [[ "${arguments}" == *" exec -T db "* ]]; then
      printf '0\n'
    fi
    ;;
  *)
    printf 'Unexpected mock Docker command: %s\n' "${command_name}" >&2
    exit 1
    ;;
esac
