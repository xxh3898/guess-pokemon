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
  login)
    /bin/cat >/dev/null
    exit 0
    ;;
  logout|pull|rm)
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
      api_command_json="${FAKE_RENDER_API_COMMAND_JSON:-null}"
      api_extra_environment="${FAKE_RENDER_API_EXTRA_ENVIRONMENT:-}"
      db_extra_environment="${FAKE_RENDER_DB_EXTRA_ENVIRONMENT:-}"
      db_user="${FAKE_RENDER_DB_USER:-guess_pokemon}"
      db_password="${FAKE_RENDER_DB_PASSWORD:-replace-with-a-random-production-password}"
      api_db_user="${FAKE_RENDER_API_DB_USER:-${db_user}}"
      api_db_password="${FAKE_RENDER_API_DB_PASSWORD:-${db_password}}"
      api_read_only="${FAKE_RENDER_API_READ_ONLY:-true}"
      api_security_opt_json="${FAKE_RENDER_API_SECURITY_OPT_JSON:-[\"no-new-privileges:true\"]}"
      db_volume_extra="${FAKE_RENDER_DB_VOLUME_EXTRA:-}"
      real_ip_source="$(
        /usr/bin/dirname "${compose_file}"
      )/infra/nginx/cloudflare-edge-real-ip.conf"
      real_ip_source="${FAKE_RENDER_REAL_IP_SOURCE:-${real_ip_source}}"
      db_healthcheck='{"test":["CMD-SHELL","pg_isready -U \"$${POSTGRES_USER}\" -d \"$${POSTGRES_DB}\""],"timeout":"5s","interval":"5s","retries":10,"start_period":"10s"}'
      db_healthcheck="${FAKE_RENDER_DB_HEALTHCHECK_JSON:-${db_healthcheck}}"
      api_healthcheck='{"test":["CMD-SHELL","wget -qO- http://127.0.0.1:8080/actuator/health/readiness | grep -q '\''\"status\":\"UP\"'\''"],"timeout":"5s","interval":"10s","retries":12,"start_period":"30s"}'
      api_healthcheck="${FAKE_RENDER_API_HEALTHCHECK_JSON:-${api_healthcheck}}"
      web_healthcheck='{"test":["CMD","wget","-q","-O","/dev/null","http://127.0.0.1/actuator/health/readiness"],"timeout":"5s","interval":"10s","retries":6,"start_period":"10s"}'
      web_healthcheck="${FAKE_RENDER_WEB_HEALTHCHECK_JSON:-${web_healthcheck}}"
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
      application_json='{"name":"guess-pokemon_application","ipam":{},"internal":true}'
      application_json="${FAKE_RENDER_APPLICATION_JSON:-${application_json}}"
      egress_json='{"name":"guess-pokemon_egress","driver":"bridge","ipam":{}}'
      egress_json="${FAKE_RENDER_EGRESS_JSON:-${egress_json}}"
      printf \
        '{"name":"guess-pokemon","services":{"db":{"image":"%s","restart":"unless-stopped","environment":{"POSTGRES_DB":"%s","POSTGRES_USER":"%s","POSTGRES_PASSWORD":"%s"%s},"healthcheck":%s,"networks":{"application":null},"volumes":[{"type":"volume","source":"postgres-data","target":"/var/lib/postgresql","volume":{}%s}],"logging":{"driver":"json-file","options":{"max-size":"10m","max-file":"3"}}},"api":{"image":"%s","restart":"unless-stopped","init":true,"read_only":%s,"pids_limit":256,"security_opt":%s,"tmpfs":["/tmp:size=128m,mode=1777"],"command":%s,"environment":{"SPRING_DATASOURCE_URL":"%s","SPRING_DATASOURCE_USERNAME":"%s","SPRING_DATASOURCE_PASSWORD":"%s","SPRING_JPA_HIBERNATE_DDL_AUTO":"%s","SERVER_FORWARD_HEADERS_STRATEGY":"native","SESSION_COOKIE_SECURE":"%s","POKEMON_ARTWORK_ENABLED":"true"%s},"healthcheck":%s,"networks":{"application":null,"egress":null},"logging":{"driver":"json-file","options":{"max-size":"10m","max-file":"3"}}},"web":{"image":"%s","restart":"%s","init":true,"read_only":true,"pids_limit":100,"security_opt":["no-new-privileges:true"],"tmpfs":["/var/cache/nginx:size=32m,mode=0755","/var/run:size=4m,mode=0755","/tmp:size=16m,mode=1777"],"scale":%s,"profiles":%s,"healthcheck":%s,"networks":{"application":null,"edge":{"aliases":["%s"]}},"volumes":[{"type":"bind","source":"%s","target":"/etc/nginx/conf.d/00-cloudflare-real-ip.conf","read_only":true}],"logging":{"driver":"json-file","options":{"max-size":"10m","max-file":"3"}}}},"networks":{"application":%s,"egress":%s,"edge":{"external":true,"name":"edge"}},"volumes":{"postgres-data":{"name":"guess-pokemon_postgres-data"}}}\n' \
        "${db_image}" \
        "${database_name}" \
        "${db_user}" \
        "${db_password}" \
        "${db_extra_environment}" \
        "${db_healthcheck}" \
        "${db_volume_extra}" \
        "${api_image}" \
        "${api_read_only}" \
        "${api_security_opt_json}" \
        "${api_command_json}" \
        "${datasource_url}" \
        "${api_db_user}" \
        "${api_db_password}" \
        "${ddl_auto}" \
        "${session_cookie_secure}" \
        "${api_extra_environment}" \
        "${api_healthcheck}" \
        "${web_image}" \
        "${web_restart}" \
        "${web_scale}" \
        "${web_profiles}" \
        "${web_healthcheck}" \
        "${edge_alias}" \
        "${real_ip_source}" \
        "${application_json}" \
        "${egress_json}"
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
