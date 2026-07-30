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
    /bin/mkdir -p "${destination}/infra/nginx" "${destination}/scripts"
    if [[ "${FAKE_FAIL_CP:-false}" == true ]]; then
      exit 1
    fi
    /bin/cp "${FAKE_RUNTIME_COMPOSE}" "${destination}/compose.yaml"
    /bin/cp \
      "${FAKE_RUNTIME_REAL_IP}" \
      "${destination}/infra/nginx/cloudflare-edge-real-ip.conf"
    /bin/cp \
      "${FAKE_RUNTIME_BACKUP_SCRIPT}" \
      "${destination}/scripts/backup-guess-pokemon.sh"
    /bin/cp \
      "${FAKE_RUNTIME_DEPLOY_SCRIPT}" \
      "${destination}/scripts/deploy-guess-pokemon.sh"
    /bin/chmod 700 \
      "${destination}/scripts/backup-guess-pokemon.sh" \
      "${destination}/scripts/deploy-guess-pokemon.sh"
    if [[ "${FAKE_RUNTIME_INVALID_DEPLOY_SYNTAX:-false}" == true ]]; then
      printf '\nif\n' >>"${destination}/scripts/deploy-guess-pokemon.sh"
    fi
    if [[ "${FAKE_RUNTIME_INSECURE_SCRIPT_MODE:-false}" == true ]]; then
      /bin/chmod 755 "${destination}/scripts/backup-guess-pokemon.sh"
    fi
    if [[ "${FAKE_RUNTIME_EXTRA_FILE:-false}" == true ]]; then
      printf 'unexpected\n' >"${destination}/unexpected"
    fi
    if [[ "${FAKE_RUNTIME_EXTRA_DIR:-false}" == true ]]; then
      /bin/mkdir "${destination}/unexpected-directory"
    fi
    if [[ "${FAKE_RUNTIME_SYMLINK:-false}" == true ]]; then
      /bin/ln -s compose.yaml "${destination}/unexpected-link"
    fi
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
      printf '%s\n' "${FAKE_CONFIG_PROJECT:-guess-pokemon}"
    else
      exit 1
    fi
    ;;
  compose)
    arguments=" $* "
    if [[ "${arguments}" == *" up "* ]] \
      && [[ -n "${FAKE_FAIL_APP_UP_ONCE_FILE:-}" ]] \
      && [[ ! -e "${FAKE_FAIL_APP_UP_ONCE_FILE}" ]]
    then
      : >"${FAKE_FAIL_APP_UP_ONCE_FILE}"
      exit 1
    elif [[ "${arguments}" == *" --format json "* ]]; then
      compose_file=
      previous_argument=
      for argument in "$@"; do
        if [[ "${previous_argument}" == --file ]]; then
          compose_file="${argument}"
          break
        fi
        previous_argument="${argument}"
      done

      candidate_render=true
      if [[ -n "${FAKE_RENDER_BASELINE_COMPOSE_FILE:-}" ]] \
        && [[ "${compose_file}" == "${FAKE_RENDER_BASELINE_COMPOSE_FILE}" ]]
      then
        candidate_render=false
      fi

      api_image="${FAKE_RENDER_API_IMAGE:-${API_IMAGE}}"
      web_image="${FAKE_RENDER_WEB_IMAGE:-${WEB_IMAGE}}"
      db_image=postgres:18.4-alpine3.24
      web_service_name="${FAKE_RENDER_WEB_SERVICE_NAME:-web}"
      edge_alias="${FAKE_RENDER_EDGE_ALIAS:-guess-pokemon-web}"
      db_volume_extra="${FAKE_RENDER_DB_VOLUME_EXTRA:-}"
      postgres_volume_extra="${FAKE_RENDER_POSTGRES_VOLUME_EXTRA:-}"
      real_ip_source="$(
        /usr/bin/dirname "${compose_file}"
      )/infra/nginx/cloudflare-edge-real-ip.conf"
      real_ip_source="${FAKE_RENDER_REAL_IP_SOURCE:-${real_ip_source}}"

      db_networks_json='{"application":null}'
      db_networks_json="${FAKE_RENDER_DB_NETWORKS_JSON:-${db_networks_json}}"
      api_networks_json='{"application":null,"egress":null}'
      api_networks_json="${FAKE_RENDER_API_NETWORKS_JSON:-${api_networks_json}}"
      web_networks_json="$(
        printf \
          '{"application":null,"edge":{"aliases":["%s"]}}' \
          "${edge_alias}"
      )"
      web_networks_json="${FAKE_RENDER_WEB_NETWORKS_JSON:-${web_networks_json}}"
      application_json='{"name":"guess-pokemon_application","ipam":{},"internal":true}'
      application_json="${FAKE_RENDER_APPLICATION_JSON:-${application_json}}"
      egress_json='{"name":"guess-pokemon_egress","driver":"bridge","ipam":{}}'
      egress_json="${FAKE_RENDER_EGRESS_JSON:-${egress_json}}"
      edge_json='{"name":"edge","external":true,"ipam":{}}'
      edge_json="${FAKE_RENDER_EDGE_JSON:-${edge_json}}"

      db_environment_extra=
      db_command_json=null
      db_entrypoint_json=null
      db_user_json=null
      db_tmpfs_json='[]'
      db_service_extra="${FAKE_RENDER_DB_SERVICE_EXTRA:-}"
      api_environment_extra="${FAKE_RENDER_API_EXTRA_ENVIRONMENT:-}"
      api_healthcheck='{"test":["CMD-SHELL","wget -qO- http://127.0.0.1:8080/actuator/health/readiness | grep -q '\''\"status\":\"UP\"'\''"],"interval":"10s"}'
      api_healthcheck="${FAKE_RENDER_API_HEALTHCHECK_JSON:-${api_healthcheck}}"
      api_command_json="${FAKE_RENDER_API_COMMAND_JSON:-null}"
      api_entrypoint_json="${FAKE_RENDER_API_ENTRYPOINT_JSON:-null}"
      api_user_json=null
      api_tmpfs_json='["/tmp:size=128m,mode=1777"]'
      api_service_extra="${FAKE_RENDER_API_SERVICE_EXTRA:-}"
      web_user_json=null
      web_tmpfs_json='["/var/cache/nginx:size=32m,mode=0755","/var/run:size=4m,mode=0755","/tmp:size=16m,mode=1777"]'
      web_service_extra="${FAKE_RENDER_WEB_SERVICE_EXTRA:-}"
      if [[ "${candidate_render}" == true ]]; then
        db_image="${FAKE_RENDER_CANDIDATE_DB_IMAGE:-${db_image}}"
        db_environment_extra="${FAKE_RENDER_CANDIDATE_DB_EXTRA_ENVIRONMENT:-}"
        db_command_json="${FAKE_RENDER_CANDIDATE_DB_COMMAND_JSON:-${db_command_json}}"
        db_entrypoint_json="${FAKE_RENDER_CANDIDATE_DB_ENTRYPOINT_JSON:-${db_entrypoint_json}}"
        api_environment_extra="${api_environment_extra}${FAKE_RENDER_CANDIDATE_API_EXTRA_ENVIRONMENT:-}"
        api_healthcheck="${FAKE_RENDER_CANDIDATE_API_HEALTHCHECK_JSON:-${api_healthcheck}}"
        api_user_json="${FAKE_RENDER_CANDIDATE_API_USER_JSON:-${api_user_json}}"
        api_tmpfs_json="${FAKE_RENDER_CANDIDATE_API_TMPFS_JSON:-${api_tmpfs_json}}"
        db_service_extra="${FAKE_RENDER_CANDIDATE_DB_SERVICE_EXTRA:-${db_service_extra}}"
        api_service_extra="${FAKE_RENDER_CANDIDATE_API_SERVICE_EXTRA:-${api_service_extra}}"
        web_service_extra="${FAKE_RENDER_CANDIDATE_WEB_SERVICE_EXTRA:-${web_service_extra}}"
      fi
      logging_json='{"driver":"json-file","options":{"max-size":"10m","max-file":"3"}}'
      logging_json="${FAKE_RENDER_LOGGING_JSON:-${logging_json}}"
      api_ports_json="${FAKE_RENDER_API_PORTS_JSON:-[]}"
      api_privileged="${FAKE_RENDER_API_PRIVILEGED:-false}"
      api_cap_add_json="${FAKE_RENDER_API_CAP_ADD_JSON:-[]}"
      api_devices_json="${FAKE_RENDER_API_DEVICES_JSON:-[]}"
      api_use_api_socket="${FAKE_RENDER_API_USE_API_SOCKET:-false}"
      api_pid_json="${FAKE_RENDER_API_PID_JSON:-null}"
      api_volumes_json="${FAKE_RENDER_API_VOLUMES_JSON:-[]}"
      api_volumes_from_json="${FAKE_RENDER_API_VOLUMES_FROM_JSON:-[]}"
      api_configs_json="${FAKE_RENDER_API_CONFIGS_JSON:-[]}"
      api_secrets_json="${FAKE_RENDER_API_SECRETS_JSON:-[]}"
      api_env_file_json="${FAKE_RENDER_API_ENV_FILE_JSON:-[]}"
      api_extra_hosts_json="${FAKE_RENDER_API_EXTRA_HOSTS_JSON:-[]}"
      api_external_links_json="${FAKE_RENDER_API_EXTERNAL_LINKS_JSON:-[]}"
      api_links_json="${FAKE_RENDER_API_LINKS_JSON:-[]}"
      extra_service_json="${FAKE_RENDER_EXTRA_SERVICE_JSON:-}"

      printf \
        '{"name":"guess-pokemon","services":{"db":{"image":"%s","environment":{"POSTGRES_DB":"guess_pokemon","POSTGRES_USER":"guess_pokemon","POSTGRES_PASSWORD":"test-password"%s},"command":%s,"entrypoint":%s,"user":%s,"tmpfs":%s,"healthcheck":{"test":["CMD-SHELL","pg_isready"]},"networks":%s,"volumes":[{"type":"volume","source":"postgres-data","target":"/var/lib/postgresql","volume":{%s}}],"logging":%s%s},"api":{"image":"%s","command":%s,"entrypoint":%s,"user":%s,"tmpfs":%s,"environment":{"SPRING_DATASOURCE_URL":"jdbc:postgresql://db:5432/guess_pokemon","SPRING_DATASOURCE_USERNAME":"guess_pokemon","SPRING_DATASOURCE_PASSWORD":"test-password","POKEMON_ARTWORK_ENABLED":"true"%s},"healthcheck":%s,"networks":%s,"ports":%s,"privileged":%s,"cap_add":%s,"devices":%s,"use_api_socket":%s,"pid":%s,"volumes":%s,"volumes_from":%s,"configs":%s,"secrets":%s,"env_file":%s,"extra_hosts":%s,"external_links":%s,"links":%s,"logging":%s%s},"%s":{"image":"%s","user":%s,"tmpfs":%s,"healthcheck":{"test":["CMD","wget","-q","-O","/dev/null","http://127.0.0.1/actuator/health/readiness"]},"networks":%s,"volumes":[{"type":"bind","source":"%s","target":"/etc/nginx/conf.d/00-cloudflare-real-ip.conf","read_only":true}],"logging":%s%s}%s},"networks":{"application":%s,"egress":%s,"edge":%s},"volumes":{"postgres-data":{"name":"guess-pokemon_postgres-data"%s}}}\n' \
        "${db_image}" \
        "${db_environment_extra}" \
        "${db_command_json}" \
        "${db_entrypoint_json}" \
        "${db_user_json}" \
        "${db_tmpfs_json}" \
        "${db_networks_json}" \
        "${db_volume_extra}" \
        "${logging_json}" \
        "${db_service_extra}" \
        "${api_image}" \
        "${api_command_json}" \
        "${api_entrypoint_json}" \
        "${api_user_json}" \
        "${api_tmpfs_json}" \
        "${api_environment_extra}" \
        "${api_healthcheck}" \
        "${api_networks_json}" \
        "${api_ports_json}" \
        "${api_privileged}" \
        "${api_cap_add_json}" \
        "${api_devices_json}" \
        "${api_use_api_socket}" \
        "${api_pid_json}" \
        "${api_volumes_json}" \
        "${api_volumes_from_json}" \
        "${api_configs_json}" \
        "${api_secrets_json}" \
        "${api_env_file_json}" \
        "${api_extra_hosts_json}" \
        "${api_external_links_json}" \
        "${api_links_json}" \
        "${logging_json}" \
        "${api_service_extra}" \
        "${web_service_name}" \
        "${web_image}" \
        "${web_user_json}" \
        "${web_tmpfs_json}" \
        "${web_networks_json}" \
        "${real_ip_source}" \
        "${logging_json}" \
        "${web_service_extra}" \
        "${extra_service_json}" \
        "${application_json}" \
        "${egress_json}" \
        "${edge_json}" \
        "${postgres_volume_extra}"
    elif [[ "${arguments}" == *" ps --status running --services "* ]]; then
      printf '%s\n' "${FAKE_RUNNING_SERVICES:-$'db\napi\nweb'}"
    elif [[ "${arguments}" == *" exec -T db "* ]]; then
      printf '0\n'
    fi
    ;;
  *)
    printf 'Unexpected mock Docker command: %s\n' "${command_name}" >&2
    exit 1
    ;;
esac
