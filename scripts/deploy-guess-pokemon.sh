#!/bin/bash

set -Eeuo pipefail

readonly DOCKER_BIN=/usr/local/bin/docker
readonly PYTHON_BIN=/usr/bin/python3
readonly APP_DIR=/Users/homeserver/Server/apps/guess-pokemon
readonly PROJECT_NAME=guess-pokemon
readonly LEGACY_COMPOSE_FILE="${APP_DIR}/compose.yaml"
readonly ENV_FILE="${APP_DIR}/.env"
readonly BACKUP_SCRIPT=/Users/homeserver/Server/scripts/backup/backup-guess-pokemon.sh
readonly RUNTIME_CONFIG_ROOT="${APP_DIR}/runtime-config"
readonly RUNTIME_CONFIG_RELEASES="${RUNTIME_CONFIG_ROOT}/releases"
readonly RUNTIME_CONFIG_STATE="${RUNTIME_CONFIG_ROOT}/state"
readonly RUNTIME_CONFIG_PENDING="${RUNTIME_CONFIG_ROOT}/pending"
readonly RUNTIME_CONFIG_CURRENT="${RUNTIME_CONFIG_ROOT}/current"
readonly RUNTIME_CONFIG_INITIALIZED="${APP_DIR}/.runtime-config-v2-initialized"
readonly API_IMAGE_REPOSITORY=ghcr.io/xxh3898/guess-pokemon-api
readonly WEB_IMAGE_REPOSITORY=ghcr.io/xxh3898/guess-pokemon-web
readonly RUNTIME_CONFIG_REPOSITORY=ghcr.io/xxh3898/guess-pokemon-runtime-config
readonly ZERO_SHA=0000000000000000000000000000000000000000
readonly ZERO_DIGEST=sha256:0000000000000000000000000000000000000000000000000000000000000000
readonly HEALTH_TIMEOUT_SECONDS=180
readonly ACTIVE_GAME_POLL_INTERVAL_SECONDS=60
readonly ACTIVE_GAME_WAIT_TIMEOUT_SECONDS=900

usage() {
  printf '%s\n' \
    'Usage:' \
    '  deploy-guess-pokemon.sh <commit-sha> <registry-user>' \
    '  deploy-guess-pokemon.sh <commit-sha> keep <registry-user>' \
    '  deploy-guess-pokemon.sh <commit-sha> update <config-digest> <registry-user>' \
    '  deploy-guess-pokemon.sh recover' \
    >&2
}

fail() {
  printf 'Guess Pokémon deployment failed: %s\n' "$1" >&2
  exit 1
}

require_legacy_compose() {
  if [[ ! -f "${LEGACY_COMPOSE_FILE}" ]]; then
    fail "legacy production Compose configuration is missing"
  fi
}

validate_initialization_marker() {
  if [[ ! -f "${RUNTIME_CONFIG_INITIALIZED}" ]] \
    || [[ -L "${RUNTIME_CONFIG_INITIALIZED}" ]] \
    || [[ "$(/bin/cat "${RUNTIME_CONFIG_INITIALIZED}")" != RUNTIME_CONFIG_V2=initialized ]]
  then
    fail "runtime config initialization marker is invalid"
  fi
}

is_digest() {
  [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]] && [[ "$1" != "${ZERO_DIGEST}" ]]
}

legacy_mode=false
recovery_mode=false
config_mode=legacy
config_digest=
commit_sha=
registry_user=

case "$#" in
  1)
    if [[ "$1" != recover ]]; then
      usage
      exit 64
    fi
    recovery_mode=true
    config_mode=recover
    ;;
  2)
    legacy_mode=true
    commit_sha="$1"
    registry_user="$2"
    ;;
  3)
    commit_sha="$1"
    config_mode="$2"
    registry_user="$3"
    if [[ "${config_mode}" != keep ]]; then
      usage
      exit 64
    fi
    ;;
  4)
    commit_sha="$1"
    config_mode="$2"
    config_digest="$3"
    registry_user="$4"
    if [[ "${config_mode}" != update ]]; then
      usage
      exit 64
    fi
    ;;
  *)
    usage
    exit 64
    ;;
esac

if [[ "${recovery_mode}" == false && ! "${commit_sha}" =~ ^[0-9a-fA-F]{40}$ ]]; then
  printf 'Commit SHA must contain exactly 40 hexadecimal characters\n' >&2
  exit 64
fi

if [[ "${recovery_mode}" == false && ! "${registry_user}" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf 'Registry user contains unsupported characters\n' >&2
  exit 64
fi

if [[ "${config_mode}" == update ]] \
  && { [[ ! "${config_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || [[ "${config_digest}" == "${ZERO_DIGEST}" ]]; }
then
  printf 'Runtime config digest must use sha256 followed by 64 lowercase hexadecimal characters\n' >&2
  exit 64
fi

if [[ ! -x "${DOCKER_BIN}" ]]; then
  fail "Docker CLI is not executable: ${DOCKER_BIN}"
fi

if [[ ! -x "${PYTHON_BIN}" ]]; then
  fail "Python is not executable: ${PYTHON_BIN}"
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  fail "production environment configuration is missing"
fi

if [[ "${recovery_mode}" == false ]] \
  && [[ -e "${RUNTIME_CONFIG_PENDING}" || -L "${RUNTIME_CONFIG_PENDING}" ]]
then
  fail "an incomplete runtime config transaction requires recovery"
fi
if [[ -e "${RUNTIME_CONFIG_INITIALIZED}" || -L "${RUNTIME_CONFIG_INITIALIZED}" ]]; then
  validate_initialization_marker
  if [[ ! -f "${RUNTIME_CONFIG_STATE}" || -L "${RUNTIME_CONFIG_STATE}" ]] \
    || [[ ! -L "${RUNTIME_CONFIG_CURRENT}" ]]
  then
    fail "initialized runtime config requires verified state and current pointer"
  fi
elif [[ "${recovery_mode}" == false ]] \
  && {
    [[ -e "${RUNTIME_CONFIG_STATE}" || -L "${RUNTIME_CONFIG_STATE}" ]] \
      || [[ -e "${RUNTIME_CONFIG_CURRENT}" || -L "${RUNTIME_CONFIG_CURRENT}" ]];
  }
then
  fail "runtime config state exists without initialization marker"
fi
if [[ "${legacy_mode}" == true ]] \
  && {
    [[ -e "${RUNTIME_CONFIG_STATE}" || -L "${RUNTIME_CONFIG_STATE}" ]] \
      || [[ -e "${RUNTIME_CONFIG_CURRENT}" || -L "${RUNTIME_CONFIG_CURRENT}" ]];
  }
then
  fail "legacy deployment is disabled after runtime config state initialization"
fi
if [[ "${legacy_mode}" == true ]]; then
  require_legacy_compose
fi

if [[ "${recovery_mode}" == false && ! -x "${BACKUP_SCRIPT}" ]]; then
  fail "production backup script is not executable"
fi

registry_token=
if [[ "${recovery_mode}" == false ]]; then
  registry_token="$(/bin/cat)"
  if [[ -z "${registry_token}" ]]; then
    printf 'GHCR token must not be empty\n' >&2
    exit 64
  fi
fi

umask 077

docker_config_dir="$(
  /usr/bin/mktemp -d "${TMPDIR:-/tmp}/guess-pokemon-docker-config.XXXXXX"
)"
env_temp=
state_temp=
pending_temp=
release_temp=
current_link_temp=
initialization_temp=
config_container_id=
prepared_release=
logged_in=false

# ShellCheck cannot infer that trap invokes this cleanup function.
# shellcheck disable=SC2329
cleanup() {
  registry_token=

  if [[ -n "${env_temp}" && -e "${env_temp}" ]]; then
    /bin/unlink "${env_temp}"
  fi

  if [[ -n "${config_container_id}" ]]; then
    "${DOCKER_BIN}" rm "${config_container_id}" >/dev/null 2>&1 || true
  fi

  for cleanup_path in \
    "${state_temp}" \
    "${pending_temp}" \
    "${current_link_temp}" \
    "${initialization_temp}"
  do
    if [[ -n "${cleanup_path}" && -e "${cleanup_path}" ]]; then
      /bin/rm -f -- "${cleanup_path}"
    fi
  done

  if [[ -n "${release_temp}" && -d "${release_temp}" ]] \
    && [[ "$(/usr/bin/basename "${release_temp}")" == .tmp.* ]]
  then
    /bin/rm -rf -- "${release_temp}"
  fi

  if [[ "${logged_in}" == true ]]; then
    "${DOCKER_BIN}" \
      --config "${docker_config_dir}" \
      logout ghcr.io \
      >/dev/null 2>&1 \
      || true
  fi

  if [[ "$(/usr/bin/basename "${docker_config_dir}")" == guess-pokemon-docker-config.* ]]; then
    /bin/rm -rf -- "${docker_config_dir}"
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

active_compose_file="${LEGACY_COMPOSE_FILE}"

compose() {
  "${DOCKER_BIN}" \
    compose \
    --project-name "${PROJECT_NAME}" \
    --project-directory "$(/usr/bin/dirname "${active_compose_file}")" \
    --env-file "${ENV_FILE}" \
    --file "${active_compose_file}" \
    "$@"
}

read_active_game_count() {
  local active_game_count

  active_game_count="$(
    # Variables expand inside the database container, not in this host shell.
    # shellcheck disable=SC2016
    compose exec -T db /bin/sh -ceu '
      exec psql \
        --username "${POSTGRES_USER}" \
        --dbname "${POSTGRES_DB}" \
        --tuples-only \
        --no-align \
        --command "SELECT count(*) FROM game WHERE status = '\''IN_PROGRESS'\''"
    ' \
      | /usr/bin/tr -d '[:space:]'
  )"

  if [[ ! "${active_game_count}" =~ ^[0-9]+$ ]]; then
    fail "could not determine active game count"
  fi

  printf '%s' "${active_game_count}"
}

wait_for_no_active_games() {
  local active_game_count
  local elapsed_seconds=0
  local sleep_seconds

  while true; do
    active_game_count="$(read_active_game_count)"

    if ((active_game_count == 0)); then
      if ((elapsed_seconds > 0)); then
        printf 'No active games remain; deployment will continue\n'
      fi
      return
    fi

    if ((elapsed_seconds >= ACTIVE_GAME_WAIT_TIMEOUT_SECONDS)); then
      fail "deployment timed out after ${ACTIVE_GAME_WAIT_TIMEOUT_SECONDS}s because ${active_game_count} game(s) are still in progress"
    fi

    sleep_seconds="${ACTIVE_GAME_POLL_INTERVAL_SECONDS}"
    if ((elapsed_seconds + sleep_seconds > ACTIVE_GAME_WAIT_TIMEOUT_SECONDS)); then
      sleep_seconds="$((ACTIVE_GAME_WAIT_TIMEOUT_SECONDS - elapsed_seconds))"
    fi

    printf \
      'Waiting %ss before checking %s active game(s) again (%ss/%ss elapsed)\n' \
      "${sleep_seconds}" \
      "${active_game_count}" \
      "${elapsed_seconds}" \
      "${ACTIVE_GAME_WAIT_TIMEOUT_SECONDS}"
    /bin/sleep "${sleep_seconds}"
    elapsed_seconds="$((elapsed_seconds + sleep_seconds))"
  done
}

read_env_value() {
  local key="$1"
  local value

  value="$(
    /usr/bin/awk -F= -v key="${key}" '
      $1 == key {
        value = substr($0, index($0, "=") + 1)
        count += 1
      }
      END {
        if (count != 1) {
          exit 1
        }
        print value
      }
    ' "${ENV_FILE}"
  )" || fail "${key} must appear exactly once in ${ENV_FILE}"

  printf '%s' "${value}"
}

write_image_env() {
  local api_image="$1"
  local web_image="$2"

  env_temp="$(/usr/bin/mktemp "${APP_DIR}/.env.tmp.XXXXXX")"

  if ! /usr/bin/awk \
    -v api_image="${api_image}" \
    -v web_image="${web_image}" '
      BEGIN {
        api_count = 0
        web_count = 0
      }
      /^API_IMAGE=/ {
        print "API_IMAGE=" api_image
        api_count += 1
        next
      }
      /^WEB_IMAGE=/ {
        print "WEB_IMAGE=" web_image
        web_count += 1
        next
      }
      {
        print
      }
      END {
        if (api_count != 1 || web_count != 1) {
          exit 1
        }
      }
    ' "${ENV_FILE}" >"${env_temp}"
  then
    fail "API_IMAGE and WEB_IMAGE must each appear once in ${ENV_FILE}"
  fi

  /bin/chmod 600 "${env_temp}"
  /bin/mv -f -- "${env_temp}" "${ENV_FILE}"
  env_temp=
}

extract_sha() {
  local image="$1"
  local repository="$2"
  local image_sha="${image#"${repository}:"}"

  if [[ "${image}" != "${repository}:${image_sha}" ]] \
    || [[ ! "${image_sha}" =~ ^[0-9a-fA-F]{40}$ ]] \
    || [[ "${image_sha}" == "0000000000000000000000000000000000000000" ]]
  then
    return 1
  fi

  printf '%s' "${image_sha}"
}

read_state_value() {
  local key="$1"
  if [[ ! -f "${RUNTIME_CONFIG_STATE}" ]]; then
    return 0
  fi
  /usr/bin/sed -n "s/^${key}=//p" "${RUNTIME_CONFIG_STATE}" \
    | /usr/bin/tail -n 1
}

release_dir_for_digest() {
  printf '%s/%s\n' "${RUNTIME_CONFIG_RELEASES}" "${1#sha256:}"
}

validate_release_files() {
  local release_dir="$1"
  local unexpected
  local files

  unexpected="$(
    /usr/bin/find "${release_dir}" ! -type d ! -type f -print
  )"
  if [[ -n "${unexpected}" ]]; then
    fail "runtime config contains unsupported file types"
  fi

  files="$(
    /usr/bin/find "${release_dir}" -type f -print \
      | /usr/bin/sed "s#^${release_dir}/##" \
      | LC_ALL=C /usr/bin/sort
  )"
  if [[ "${files}" != $'compose.yaml\ninfra/nginx/cloudflare-edge-real-ip.conf' ]]; then
    fail "runtime config file allowlist does not match"
  fi
}

runtime_config_content_sha256() {
  local release_dir="$1"
  {
    /usr/bin/shasum -a 256 "${release_dir}/compose.yaml"
    /usr/bin/shasum -a 256 \
      "${release_dir}/infra/nginx/cloudflare-edge-real-ip.conf"
  } | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}'
}

validate_compose_contract() {
  local compose_file="$1"
  local api_image="$2"
  local web_image="$3"
  local baseline_compose_file="$4"
  local baseline_api_image="$5"
  local baseline_web_image="$6"
  local baseline_rendered
  local rendered

  API_IMAGE="${api_image}" \
  WEB_IMAGE="${web_image}" \
    "${DOCKER_BIN}" \
      compose \
      --project-name "${PROJECT_NAME}" \
      --project-directory "$(/usr/bin/dirname "${compose_file}")" \
      --env-file "${ENV_FILE}" \
      --file "${compose_file}" \
      config \
      --no-env-resolution \
      --quiet

  rendered="$(
    API_IMAGE="${api_image}" \
    WEB_IMAGE="${web_image}" \
      "${DOCKER_BIN}" \
        compose \
        --project-name "${PROJECT_NAME}" \
        --project-directory "$(/usr/bin/dirname "${compose_file}")" \
        --env-file "${ENV_FILE}" \
        --file "${compose_file}" \
        config \
        --no-env-resolution \
        --format json
  )"

  API_IMAGE="${baseline_api_image}" \
  WEB_IMAGE="${baseline_web_image}" \
    "${DOCKER_BIN}" \
      compose \
      --project-name "${PROJECT_NAME}" \
      --project-directory "$(/usr/bin/dirname "${baseline_compose_file}")" \
      --env-file "${ENV_FILE}" \
      --file "${baseline_compose_file}" \
      config \
      --no-env-resolution \
      --quiet

  baseline_rendered="$(
    API_IMAGE="${baseline_api_image}" \
    WEB_IMAGE="${baseline_web_image}" \
      "${DOCKER_BIN}" \
        compose \
        --project-name "${PROJECT_NAME}" \
        --project-directory "$(/usr/bin/dirname "${baseline_compose_file}")" \
        --env-file "${ENV_FILE}" \
        --file "${baseline_compose_file}" \
        config \
        --no-env-resolution \
        --format json
  )"

  printf '%s\0%s' "${rendered}" "${baseline_rendered}" \
    | "${PYTHON_BIN}" -c '
import json
import sys

documents = sys.stdin.buffer.read().split(b"\0")
if len(documents) != 2:
    raise SystemExit("Compose validation input is invalid")
config = json.loads(documents[0])
baseline = json.loads(documents[1])
(
    expected_api_image,
    expected_web_image,
    expected_real_ip_source,
) = sys.argv[1:4]
services = config.get("services", {})
baseline_services = baseline.get("services", {})
networks = config.get("networks", {})
volumes = config.get("volumes", {})

if not isinstance(services, dict):
    raise SystemExit("Compose services must be an object")
if not isinstance(baseline_services, dict):
    raise SystemExit("active Compose services must be an object")
if not isinstance(networks, dict):
    raise SystemExit("Compose networks must be an object")
if not isinstance(volumes, dict):
    raise SystemExit("Compose volumes must be an object")
if set(services) != {"db", "api", "web"}:
    raise SystemExit("Compose service set is invalid")
if set(networks) != {"application", "egress", "edge"}:
    raise SystemExit("Compose network set is invalid")
if set(volumes) != {"postgres-data"}:
    raise SystemExit("Compose top-level volume set is invalid")
for name in ("db", "api", "web"):
    if not isinstance(services.get(name), dict):
        raise SystemExit(f"required service is missing: {name}")
    if not isinstance(baseline_services.get(name), dict):
        raise SystemExit(f"active required service is missing: {name}")

if services["api"].get("image") != expected_api_image:
    raise SystemExit("API image does not match the requested deployment")
if services["web"].get("image") != expected_web_image:
    raise SystemExit("Web image does not match the requested deployment")
for name in ("api", "web"):
    for field in ("command", "entrypoint"):
        if services[name].get(field) is not None:
            raise SystemExit(f"{name} must not override the image {field}")
if services["db"].get("image") != baseline_services["db"].get("image"):
    raise SystemExit("database image differs from the active verified configuration")

for field in ("command", "entrypoint"):
    if services["db"].get(field) != baseline_services["db"].get(field):
        raise SystemExit(f"database {field} differs from the active verified configuration")

def environment_for(service, name):
    environment = service.get("environment", {})
    if environment is None:
        return {}
    if not isinstance(environment, dict):
        raise SystemExit(f"{name} environment contract is invalid")
    return environment

def protected_environment(environment, prefixes, exact_names=()):
    return {
        key: value
        for key, value in environment.items()
        if key in exact_names or any(key.startswith(prefix) for prefix in prefixes)
    }

candidate_db_environment = environment_for(services["db"], "database")
baseline_db_environment = environment_for(baseline_services["db"], "active database")
if protected_environment(
    candidate_db_environment,
    ("POSTGRES_",),
    ("PGDATA",),
) != protected_environment(
    baseline_db_environment,
    ("POSTGRES_",),
    ("PGDATA",),
):
    raise SystemExit("database storage environment differs from the active verified configuration")

candidate_api_environment = environment_for(services["api"], "API")
baseline_api_environment = environment_for(baseline_services["api"], "active API")
data_environment_prefixes = (
    "SPRING_DATASOURCE_",
    "SPRING_FLYWAY_",
    "SPRING_JPA_",
    "SPRING_LIQUIBASE_",
    "SPRING_PROFILES_",
    "SPRING_CONFIG_",
    "SPRING_SQL_INIT_",
)
data_environment_names = (
    "SPRING_APPLICATION_JSON",
    "JAVA_TOOL_OPTIONS",
    "JDK_JAVA_OPTIONS",
    "_JAVA_OPTIONS",
    "JAVA_OPTS",
)
if protected_environment(
    candidate_api_environment,
    data_environment_prefixes,
    data_environment_names,
) != protected_environment(
    baseline_api_environment,
    data_environment_prefixes,
    data_environment_names,
):
    raise SystemExit("API data configuration differs from the active verified configuration")

expected_healthcheck_fragments = {
    "db": ("pg_isready",),
    "api": (
        "http://127.0.0.1:8080/actuator/health/readiness",
        "status",
        "UP",
    ),
    "web": ("http://127.0.0.1/actuator/health/readiness",),
}
for name, expected_fragments in expected_healthcheck_fragments.items():
    candidate_healthcheck = services[name].get("healthcheck", {})
    if not isinstance(candidate_healthcheck, dict):
        raise SystemExit(f"{name} healthcheck contract is invalid")
    healthcheck_test = candidate_healthcheck.get("test")
    if (
        not isinstance(healthcheck_test, list)
        or not healthcheck_test
        or healthcheck_test[0] not in ("CMD", "CMD-SHELL")
        or candidate_healthcheck.get("disable") is True
    ):
        raise SystemExit(f"{name} healthcheck probe is invalid")
    serialized_healthcheck = json.dumps(healthcheck_test, separators=(",", ":"))
    if any(fragment not in serialized_healthcheck for fragment in expected_fragments):
        raise SystemExit(f"{name} healthcheck probe is invalid")

expected_service_networks = {
    "db": {"application"},
    "api": {"application", "egress"},
    "web": {"application", "edge"},
}
for name, expected_networks in expected_service_networks.items():
    service_networks = services[name].get("networks", {})
    if not isinstance(service_networks, dict):
        raise SystemExit(f"{name} network contract is invalid")
    if set(service_networks) != expected_networks:
        raise SystemExit(f"{name} network contract is invalid")

web_edge = services["web"]["networks"].get("edge")
web_edge_aliases = web_edge.get("aliases", []) if isinstance(web_edge, dict) else []
if (
    not isinstance(web_edge_aliases, list)
    or len(web_edge_aliases) != 1
    or set(web_edge_aliases) != {"guess-pokemon-web"}
):
    raise SystemExit("web edge alias set is invalid")

application_network = networks.get("application", {})
egress_network = networks.get("egress", {})
edge_network = networks.get("edge", {})
if (
    not isinstance(application_network, dict)
    or application_network.get("name") != "guess-pokemon_application"
    or application_network.get("driver", "bridge") != "bridge"
    or application_network.get("internal") is not True
    or application_network.get("external") is True
    or application_network.get("driver_opts")
):
    raise SystemExit("application network boundary is invalid")
if (
    not isinstance(egress_network, dict)
    or egress_network.get("name") != "guess-pokemon_egress"
    or egress_network.get("external") is True
    or egress_network.get("driver", "bridge") != "bridge"
    or egress_network.get("internal") is True
    or egress_network.get("driver_opts")
):
    raise SystemExit("egress network boundary is invalid")
if (
    not isinstance(edge_network, dict)
    or edge_network.get("name") != "edge"
    or edge_network.get("external") is not True
):
    raise SystemExit("edge network boundary is invalid")

expected_real_ip_target = "/etc/nginx/conf.d/00-cloudflare-real-ip.conf"
candidate_bind_count = 0
for name, service in services.items():
    if not isinstance(service, dict):
        raise SystemExit(f"{name} service contract is invalid")
    if service.get("ports"):
        raise SystemExit(f"{name} must not publish host ports")
    if service.get("privileged") is True:
        raise SystemExit(f"{name} must not run privileged")
    if service.get("cap_add") or service.get("devices"):
        raise SystemExit(f"{name} must not add host privileges or devices")
    if service.get("use_api_socket") is True:
        raise SystemExit(f"{name} must not use the Docker API socket")
    for field in ("volumes_from", "configs", "secrets", "env_file"):
        if service.get(field):
            raise SystemExit(f"{name} must not use {field}")
    for field in ("extra_hosts", "external_links", "links"):
        if service.get(field):
            raise SystemExit(f"{name} must not override service discovery with {field}")
    for field in ("pid", "ipc", "uts", "userns_mode", "network_mode", "cgroup"):
        if service.get(field) == "host":
            raise SystemExit(f"{name} must not join a host namespace")

    service_volumes = service.get("volumes", [])
    if not isinstance(service_volumes, list):
        raise SystemExit(f"{name} volume contract is invalid")
    for volume in service_volumes:
        if not isinstance(volume, dict):
            raise SystemExit(f"{name} volume contract is invalid")
        source = volume.get("source")
        target = volume.get("target")
        if source in ("/var/run/docker.sock", "/run/docker.sock") or target in (
            "/var/run/docker.sock",
            "/run/docker.sock",
        ):
            raise SystemExit(f"{name} must not mount the Docker socket")
        if volume.get("type") == "bind":
            if (
                name != "web"
                or source != expected_real_ip_source
                or target != expected_real_ip_target
                or volume.get("read_only") is not True
            ):
                raise SystemExit(f"{name} contains an unapproved host bind")
            candidate_bind_count += 1

db_volumes = services["db"].get("volumes", [])
api_volumes = services["api"].get("volumes", [])
web_volumes = services["web"].get("volumes", [])
if len(db_volumes) != 1:
    raise SystemExit("database service volume set is invalid")
if api_volumes:
    raise SystemExit("API service must not mount volumes")
if len(web_volumes) != 1:
    raise SystemExit("Web service volume set is invalid")
if candidate_bind_count != 1:
    raise SystemExit("pinned Cloudflare real-IP bind is missing")

for name, volume in volumes.items():
    if not isinstance(volume, dict):
        raise SystemExit(f"{name} top-level volume contract is invalid")
    if volume.get("driver_opts"):
        raise SystemExit(f"{name} top-level volume must not map a host path")

db_data = next(
    (
        volume
        for volume in db_volumes
        if isinstance(volume, dict)
        and volume.get("target") == "/var/lib/postgresql"
    ),
    None,
)
postgres_data = volumes.get("postgres-data")
if (
    not isinstance(postgres_data, dict)
    or postgres_data.get("name") != "guess-pokemon_postgres-data"
    or postgres_data.get("external") is True
    or postgres_data.get("driver", "local") != "local"
):
    raise SystemExit("top-level PostgreSQL volume contract is invalid")
if (
    db_data is None
    or db_data.get("type") != "volume"
    or db_data.get("source") != "postgres-data"
    or db_data.get("target") != "/var/lib/postgresql"
    or db_data.get("volume", {}).get("subpath")
):
    raise SystemExit("PostgreSQL persistent volume contract is invalid")
' \
      "${api_image}" \
      "${web_image}" \
      "$(/usr/bin/dirname "${compose_file}")/infra/nginx/cloudflare-edge-real-ip.conf"
}

prepare_runtime_release() {
  local digest="$1"
  local expected_revision="$2"
  local config_image="${RUNTIME_CONFIG_REPOSITORY}@${digest}"
  local actual_project
  local actual_revision
  local release_dir

  "${DOCKER_BIN}" \
    --config "${docker_config_dir}" \
    pull "${config_image}" \
    >/dev/null

  actual_revision="$(
    "${DOCKER_BIN}" \
      image inspect \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
      "${config_image}"
  )"
  if [[ "${actual_revision}" != "${expected_revision}" ]]; then
    fail "runtime config revision label does not match deployment revision"
  fi

  actual_project="$(
    "${DOCKER_BIN}" \
      image inspect \
      --format '{{ index .Config.Labels "io.chochiho.runtime-config.project" }}' \
      "${config_image}"
  )"
  if [[ "${actual_project}" != guess-pokemon ]]; then
    fail "runtime config project label is invalid"
  fi

  /bin/mkdir -p "${RUNTIME_CONFIG_RELEASES}"
  release_dir="$(release_dir_for_digest "${digest}")"
  release_temp="$(
    /usr/bin/mktemp -d "${RUNTIME_CONFIG_RELEASES}/.tmp.XXXXXX"
  )"
  config_container_id="$("${DOCKER_BIN}" create "${config_image}")"
  "${DOCKER_BIN}" cp "${config_container_id}:/runtime/." "${release_temp}"
  "${DOCKER_BIN}" rm "${config_container_id}" >/dev/null
  config_container_id=

  validate_release_files "${release_temp}"
  /bin/chmod -R go-rwx "${release_temp}"

  if [[ -d "${release_dir}" ]]; then
    validate_release_files "${release_dir}"
    if ! /usr/bin/diff -qr "${release_temp}" "${release_dir}" >/dev/null; then
      fail "existing runtime config release differs from exact digest artifact"
    fi
    /bin/rm -rf -- "${release_temp}"
    release_temp=
    prepared_release="${release_dir}"
    return 0
  fi

  /bin/mv -- "${release_temp}" "${release_dir}"
  release_temp=
  prepared_release="${release_dir}"
}

write_pending_state() {
  local previous_sha="$1"
  local previous_config_digest="$2"
  local target_sha="$3"
  local target_config_digest="$4"

  /bin/mkdir -p "${RUNTIME_CONFIG_ROOT}"
  pending_temp="$(
    /usr/bin/mktemp "${RUNTIME_CONFIG_ROOT}/.pending.tmp.XXXXXX"
  )"
  {
    printf 'PREVIOUS_APPLICATION_REVISION=%s\n' "${previous_sha}"
    printf 'PREVIOUS_RUNTIME_CONFIG_DIGEST=%s\n' "${previous_config_digest}"
    printf 'TARGET_APPLICATION_REVISION=%s\n' "${target_sha}"
    printf 'TARGET_RUNTIME_CONFIG_DIGEST=%s\n' "${target_config_digest}"
  } >"${pending_temp}"
  /bin/chmod 600 "${pending_temp}"
  /bin/mv -f -- "${pending_temp}" "${RUNTIME_CONFIG_PENDING}"
  pending_temp=
}

replace_current_link() {
  local release_dir="$1"

  current_link_temp="${RUNTIME_CONFIG_ROOT}/.current.$$"
  /bin/ln -s "releases/$("/usr/bin/basename" "${release_dir}")" "${current_link_temp}"
  "${PYTHON_BIN}" -c \
    'import os, sys; os.replace(sys.argv[1], sys.argv[2])' \
    "${current_link_temp}" \
    "${RUNTIME_CONFIG_CURRENT}"
  current_link_temp=
}

write_initialization_marker() {
  if [[ -e "${RUNTIME_CONFIG_INITIALIZED}" || -L "${RUNTIME_CONFIG_INITIALIZED}" ]]; then
    validate_initialization_marker
    return
  fi

  initialization_temp="$(
    /usr/bin/mktemp "${APP_DIR}/.runtime-config-v2-initialized.tmp.XXXXXX"
  )"
  printf 'RUNTIME_CONFIG_V2=initialized\n' >"${initialization_temp}"
  /bin/chmod 400 "${initialization_temp}"
  /bin/mv -f -- "${initialization_temp}" "${RUNTIME_CONFIG_INITIALIZED}"
  initialization_temp=
}

write_success_state() {
  local application_revision="$1"
  local runtime_config_digest="$2"
  local runtime_config_revision="$3"
  local runtime_config_content_sha="$4"
  local previous_sha="$5"
  local previous_config_digest="$6"
  local release_dir="$7"

  state_temp="$(
    /usr/bin/mktemp "${RUNTIME_CONFIG_ROOT}/.state.tmp.XXXXXX"
  )"
  {
    printf 'APPLICATION_REVISION=%s\n' "${application_revision}"
    printf 'RUNTIME_CONFIG_DIGEST=%s\n' "${runtime_config_digest}"
    printf 'RUNTIME_CONFIG_REVISION=%s\n' "${runtime_config_revision}"
    printf 'RUNTIME_CONFIG_CONTENT_SHA256=%s\n' "${runtime_config_content_sha}"
    printf 'PREVIOUS_APPLICATION_REVISION=%s\n' "${previous_sha}"
    printf 'PREVIOUS_RUNTIME_CONFIG_DIGEST=%s\n' "${previous_config_digest}"
  } >"${state_temp}"
  /bin/chmod 600 "${state_temp}"
  /bin/mv -f -- "${state_temp}" "${RUNTIME_CONFIG_STATE}"
  state_temp=

  replace_current_link "${release_dir}"
  write_initialization_marker
  /bin/rm -f -- "${RUNTIME_CONFIG_PENDING}"
}

read_pending_value() {
  local key="$1"
  local value

  value="$(
    /usr/bin/awk -F= -v key="${key}" '
      $1 == key {
        value = substr($0, index($0, "=") + 1)
        count += 1
      }
      END {
        if (count != 1) {
          exit 1
        }
        print value
      }
    ' "${RUNTIME_CONFIG_PENDING}"
  )" || fail "${key} must appear exactly once in ${RUNTIME_CONFIG_PENDING}"

  printf '%s' "${value}"
}

validate_pending_state() {
  local keys

  if [[ ! -f "${RUNTIME_CONFIG_PENDING}" || -L "${RUNTIME_CONFIG_PENDING}" ]]; then
    fail "runtime config recovery requires a regular pending state file"
  fi

  keys="$(
    /usr/bin/awk -F= 'NF >= 2 { print $1 }' "${RUNTIME_CONFIG_PENDING}" \
      | LC_ALL=C /usr/bin/sort
  )"
  if [[ "${keys}" != $'PREVIOUS_APPLICATION_REVISION\nPREVIOUS_RUNTIME_CONFIG_DIGEST\nTARGET_APPLICATION_REVISION\nTARGET_RUNTIME_CONFIG_DIGEST' ]]; then
    fail "runtime config pending state keys are invalid"
  fi
}

validate_state_file() {
  local application_revision
  local keys
  local previous_revision
  local previous_digest
  local runtime_content_sha
  local runtime_digest
  local runtime_revision

  if [[ ! -f "${RUNTIME_CONFIG_STATE}" || -L "${RUNTIME_CONFIG_STATE}" ]]; then
    fail "runtime config state must be a regular non-symlink file"
  fi
  keys="$(
    /usr/bin/awk -F= 'NF >= 2 { print $1 }' "${RUNTIME_CONFIG_STATE}" \
      | LC_ALL=C /usr/bin/sort
  )"
  if [[ "${keys}" != $'APPLICATION_REVISION\nPREVIOUS_APPLICATION_REVISION\nPREVIOUS_RUNTIME_CONFIG_DIGEST\nRUNTIME_CONFIG_CONTENT_SHA256\nRUNTIME_CONFIG_DIGEST\nRUNTIME_CONFIG_REVISION' ]]; then
    fail "runtime config state keys are invalid"
  fi

  application_revision="$(read_state_value APPLICATION_REVISION)"
  previous_revision="$(read_state_value PREVIOUS_APPLICATION_REVISION)"
  previous_digest="$(read_state_value PREVIOUS_RUNTIME_CONFIG_DIGEST)"
  runtime_content_sha="$(read_state_value RUNTIME_CONFIG_CONTENT_SHA256)"
  runtime_digest="$(read_state_value RUNTIME_CONFIG_DIGEST)"
  runtime_revision="$(read_state_value RUNTIME_CONFIG_REVISION)"
  if [[ ! "${application_revision}" =~ ^[0-9a-f]{40}$ ]] \
    || [[ "${application_revision}" == "${ZERO_SHA}" ]] \
    || [[ ! "${previous_revision}" =~ ^[0-9a-f]{40}$ ]] \
    || { [[ "${previous_digest}" != "${ZERO_DIGEST}" ]] && ! is_digest "${previous_digest}"; } \
    || [[ ! "${runtime_content_sha}" =~ ^[0-9a-f]{64}$ ]] \
    || ! is_digest "${runtime_digest}" \
    || [[ ! "${runtime_revision}" =~ ^[0-9a-f]{40}$ ]] \
    || [[ "${runtime_revision}" == "${ZERO_SHA}" ]]
  then
    fail "runtime config state values are invalid"
  fi
}

validate_verified_release() {
  local digest="$1"
  local expected_content_sha="$2"
  local release_dir

  if [[ ! "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || [[ "${digest}" == "${ZERO_DIGEST}" ]] \
    || [[ ! "${expected_content_sha}" =~ ^[0-9a-f]{64}$ ]]
  then
    fail "runtime config state is invalid"
  fi

  release_dir="$(release_dir_for_digest "${digest}")"
  if [[ ! -d "${release_dir}" ]]; then
    fail "runtime config release is missing during recovery"
  fi
  validate_release_files "${release_dir}"
  if [[ "$(runtime_config_content_sha256 "${release_dir}")" != "${expected_content_sha}" ]]; then
    fail "runtime config release integrity check failed during recovery"
  fi

  printf '%s' "${release_dir}"
}

running_service_set_is_complete() {
  local services

  services="$(compose ps --status running --services | LC_ALL=C /usr/bin/sort)"
  /usr/bin/grep -qx api <<<"${services}" \
    && /usr/bin/grep -qx db <<<"${services}" \
    && /usr/bin/grep -qx web <<<"${services}"
}

recover_pending_transaction() {
  local previous_sha
  local previous_digest
  local target_sha
  local target_digest
  local state_sha
  local state_digest
  local state_content_sha
  local state_previous_sha
  local state_previous_digest
  local recovery_release
  local recovery_api_image
  local recovery_web_image
  local expected_current

  validate_pending_state
  if [[ -e "${RUNTIME_CONFIG_STATE}" || -L "${RUNTIME_CONFIG_STATE}" ]]; then
    validate_state_file
  fi
  previous_sha="$(read_pending_value PREVIOUS_APPLICATION_REVISION)"
  previous_digest="$(read_pending_value PREVIOUS_RUNTIME_CONFIG_DIGEST)"
  target_sha="$(read_pending_value TARGET_APPLICATION_REVISION)"
  target_digest="$(read_pending_value TARGET_RUNTIME_CONFIG_DIGEST)"

  if [[ ! "${previous_sha}" =~ ^[0-9a-f]{40}$ ]] \
    || [[ ! "${target_sha}" =~ ^[0-9a-f]{40}$ ]] \
    || [[ ! "${previous_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || [[ ! "${target_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || [[ "${target_digest}" == "${ZERO_DIGEST}" ]]
  then
    fail "runtime config pending state values are invalid"
  fi

  state_sha="$(read_state_value APPLICATION_REVISION)"
  state_digest="$(read_state_value RUNTIME_CONFIG_DIGEST)"
  state_content_sha="$(read_state_value RUNTIME_CONFIG_CONTENT_SHA256)"
  state_previous_sha="$(read_state_value PREVIOUS_APPLICATION_REVISION)"
  state_previous_digest="$(read_state_value PREVIOUS_RUNTIME_CONFIG_DIGEST)"

  if [[ "${state_sha}" == "${target_sha}" && "${state_digest}" == "${target_digest}" ]]; then
    if [[ "${previous_sha}" != "${target_sha}" ]] \
      || [[ "${previous_digest}" != "${target_digest}" ]]
    then
      if [[ "${state_previous_sha}" != "${previous_sha}" ]] \
        || [[ "${state_previous_digest}" != "${previous_digest}" ]]
      then
        fail "completed target predecessor does not match pending state"
      fi
    fi
    recovery_release="$(
      validate_verified_release "${target_digest}" "${state_content_sha}"
    )"
    recovery_api_image="${API_IMAGE_REPOSITORY}:${target_sha}"
    recovery_web_image="${WEB_IMAGE_REPOSITORY}:${target_sha}"
    if [[ "$(read_env_value API_IMAGE)" != "${recovery_api_image}" ]] \
      || [[ "$(read_env_value WEB_IMAGE)" != "${recovery_web_image}" ]]
    then
      fail "application image environment does not match completed target state"
    fi

    active_compose_file="${recovery_release}/compose.yaml"
    validate_compose_contract \
      "${active_compose_file}" \
      "${recovery_api_image}" \
      "${recovery_web_image}" \
      "${active_compose_file}" \
      "${recovery_api_image}" \
      "${recovery_web_image}"
    if ! compose up \
      --detach \
      --no-build \
      --pull never \
      --remove-orphans \
      --wait \
      --wait-timeout "${HEALTH_TIMEOUT_SECONDS}" \
      || ! running_service_set_is_complete
    then
      fail "completed target services did not pass readiness verification"
    fi

    expected_current="releases/$("/usr/bin/basename" "${recovery_release}")"
    if [[ ! -L "${RUNTIME_CONFIG_CURRENT}" ]] \
      || [[ "$(/usr/bin/readlink "${RUNTIME_CONFIG_CURRENT}")" != "${expected_current}" ]]
    then
      replace_current_link "${recovery_release}"
    fi
    write_initialization_marker
    /bin/rm -f -- "${RUNTIME_CONFIG_PENDING}"
    printf 'Completed Guess Pokémon runtime config transaction finalized: %s\n' "${target_sha}"
    return 0
  fi

  if [[ "${previous_sha}" == "${ZERO_SHA}" ]]; then
    if [[ -n "${state_sha}" || "${previous_digest}" != "${ZERO_DIGEST}" ]]; then
      fail "bootstrap recovery state is inconsistent"
    fi
    require_legacy_compose
    write_image_env \
      "${API_IMAGE_REPOSITORY}:${ZERO_SHA}" \
      "${WEB_IMAGE_REPOSITORY}:${ZERO_SHA}"
    active_compose_file="${LEGACY_COMPOSE_FILE}"
    if ! compose stop api web; then
      fail "bootstrap recovery could not stop interrupted app services"
    fi
    /bin/rm -f -- "${RUNTIME_CONFIG_PENDING}"
    printf 'Interrupted Guess Pokémon bootstrap cleared with app services stopped\n'
    return 0
  fi

  recovery_api_image="${API_IMAGE_REPOSITORY}:${previous_sha}"
  recovery_web_image="${WEB_IMAGE_REPOSITORY}:${previous_sha}"
  if [[ -z "${state_sha}" && -z "${state_digest}" && "${previous_digest}" == "${ZERO_DIGEST}" ]]; then
    require_legacy_compose
    active_compose_file="${LEGACY_COMPOSE_FILE}"
  else
    if [[ "${state_sha}" != "${previous_sha}" || "${state_digest}" != "${previous_digest}" ]]; then
      fail "pending transaction does not match the last verified runtime config state"
    fi
    recovery_release="$(
      validate_verified_release "${previous_digest}" "${state_content_sha}"
    )"
    active_compose_file="${recovery_release}/compose.yaml"
  fi

  validate_compose_contract \
    "${active_compose_file}" \
    "${recovery_api_image}" \
    "${recovery_web_image}" \
    "${active_compose_file}" \
    "${recovery_api_image}" \
    "${recovery_web_image}"

  write_image_env "${recovery_api_image}" "${recovery_web_image}"
  if ! compose up \
    --detach \
    --no-build \
    --pull never \
    --remove-orphans \
    --wait \
    --wait-timeout "${HEALTH_TIMEOUT_SECONDS}"
  then
    fail "runtime config recovery could not restore the previous verified pair"
  fi
  if ! running_service_set_is_complete; then
    fail "runtime config recovery did not restore every required service"
  fi

  if [[ -n "${state_sha}" ]]; then
    expected_current="releases/$("/usr/bin/basename" "${recovery_release}")"
    if [[ ! -L "${RUNTIME_CONFIG_CURRENT}" ]] \
      || [[ "$(/usr/bin/readlink "${RUNTIME_CONFIG_CURRENT}")" != "${expected_current}" ]]
    then
      replace_current_link "${recovery_release}"
    fi
    write_initialization_marker
  fi
  /bin/rm -f -- "${RUNTIME_CONFIG_PENDING}"
  printf 'Guess Pokémon runtime config transaction recovered to: %s\n' "${previous_sha}"
}

if [[ "${recovery_mode}" == true ]]; then
  recover_pending_transaction
  exit 0
fi

normalized_sha="$(
  printf '%s' "${commit_sha}" \
    | /usr/bin/tr '[:upper:]' '[:lower:]'
)"
new_api_image="${API_IMAGE_REPOSITORY}:${normalized_sha}"
new_web_image="${WEB_IMAGE_REPOSITORY}:${normalized_sha}"
current_api_image="$(read_env_value API_IMAGE)"
current_web_image="$(read_env_value WEB_IMAGE)"
previous_sha=

current_api_sha="$(extract_sha "${current_api_image}" "${API_IMAGE_REPOSITORY}")" \
  || current_api_sha=
current_web_sha="$(extract_sha "${current_web_image}" "${WEB_IMAGE_REPOSITORY}")" \
  || current_web_sha=

if [[ -n "${current_api_sha}" || -n "${current_web_sha}" ]]; then
  if [[ -z "${current_api_sha}" || "${current_api_sha}" != "${current_web_sha}" ]]; then
    fail "current API and web images do not share one valid commit SHA"
  fi
  previous_sha="${current_api_sha}"
fi

printf '%s' "${registry_token}" \
  | "${DOCKER_BIN}" \
      --config "${docker_config_dir}" \
      login ghcr.io \
      --username "${registry_user}" \
      --password-stdin \
      >/dev/null
logged_in=true
registry_token=

"${DOCKER_BIN}" --config "${docker_config_dir}" pull "${new_api_image}"
"${DOCKER_BIN}" --config "${docker_config_dir}" pull "${new_web_image}"

if [[ "${legacy_mode}" == true ]]; then
  current_compose_file="${LEGACY_COMPOSE_FILE}"
  candidate_compose_file="${LEGACY_COMPOSE_FILE}"
else
  for image in "${new_api_image}" "${new_web_image}"; do
    actual_revision="$(
      "${DOCKER_BIN}" \
        image inspect \
        --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
        "${image}"
    )"
    if [[ "${actual_revision}" != "${normalized_sha}" ]]; then
      fail "application image revision label does not match deployment revision"
    fi
  done

  current_config_digest="$(read_state_value RUNTIME_CONFIG_DIGEST)"
  current_config_revision="$(read_state_value RUNTIME_CONFIG_REVISION)"
  current_config_content_sha="$(read_state_value RUNTIME_CONFIG_CONTENT_SHA256)"
  current_state_sha="$(read_state_value APPLICATION_REVISION)"

  if [[ ! -e "${RUNTIME_CONFIG_STATE}" && ! -L "${RUNTIME_CONFIG_STATE}" ]] \
    && [[ -e "${RUNTIME_CONFIG_CURRENT}" || -L "${RUNTIME_CONFIG_CURRENT}" ]]
  then
    fail "runtime config state is missing while the current release pointer exists"
  fi
  if [[ -e "${RUNTIME_CONFIG_STATE}" || -L "${RUNTIME_CONFIG_STATE}" ]] \
    && {
      [[ ! -f "${RUNTIME_CONFIG_STATE}" ]] \
        || [[ -L "${RUNTIME_CONFIG_STATE}" ]] \
        || [[ ! "${current_config_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] \
        || [[ "${current_config_digest}" == "${ZERO_DIGEST}" ]] \
        || [[ ! "${current_config_revision}" =~ ^[0-9a-f]{40}$ ]] \
        || [[ ! "${current_config_content_sha}" =~ ^[0-9a-f]{64}$ ]] \
        || [[ "${current_state_sha}" != "${previous_sha}" ]];
    }
  then
    fail "current runtime config state is invalid"
  fi
  if [[ -e "${RUNTIME_CONFIG_STATE}" || -L "${RUNTIME_CONFIG_STATE}" ]]; then
    validate_state_file
  fi

  if [[ "${current_config_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] \
    && [[ "${current_config_digest}" != "${ZERO_DIGEST}" ]]
  then
    current_release="$(release_dir_for_digest "${current_config_digest}")"
    current_compose_file="${current_release}/compose.yaml"
  else
    current_release=
    require_legacy_compose
    current_compose_file="${LEGACY_COMPOSE_FILE}"
  fi

  if [[ -n "${current_release}" ]]; then
    if [[ ! "${current_config_revision}" =~ ^[0-9a-f]{40}$ ]] \
      || [[ ! "${current_config_content_sha}" =~ ^[0-9a-f]{64}$ ]]
    then
      fail "current runtime config state is invalid"
    fi
    if [[ ! -d "${current_release}" ]]; then
      fail "current runtime config release is missing"
    fi
    validate_release_files "${current_release}"
    if [[ "$(runtime_config_content_sha256 "${current_release}")" != "${current_config_content_sha}" ]]; then
      fail "current runtime config release integrity check failed"
    fi
  fi

  if [[ "${config_mode}" == update ]]; then
    candidate_config_digest="${config_digest}"
    candidate_config_revision="${normalized_sha}"
    prepare_runtime_release "${config_digest}" "${normalized_sha}"
    candidate_release="${prepared_release}"
    candidate_config_content_sha="$(
      runtime_config_content_sha256 "${candidate_release}"
    )"
  else
    if [[ -z "${current_release}" ]]; then
      fail "keep mode requires an existing verified runtime config state"
    fi
    candidate_config_digest="${current_config_digest}"
    candidate_config_revision="${current_config_revision}"
    candidate_config_content_sha="${current_config_content_sha}"
    candidate_release="${current_release}"
  fi

  candidate_compose_file="${candidate_release}/compose.yaml"
fi

validate_compose_contract \
  "${candidate_compose_file}" \
  "${new_api_image}" \
  "${new_web_image}" \
  "${current_compose_file}" \
  "${current_api_image}" \
  "${current_web_image}"

active_compose_file="${current_compose_file}"
running_services="$(compose ps --status running --services)"
if ! /usr/bin/grep -qx db <<<"${running_services}"; then
  fail "production db service must be running before deployment"
fi

wait_for_no_active_games

"${BACKUP_SCRIPT}"

if [[ "${legacy_mode}" == false ]]; then
  previous_config_digest="${current_config_digest:-${ZERO_DIGEST}}"
  write_pending_state \
    "${previous_sha:-${ZERO_SHA}}" \
    "${previous_config_digest}" \
    "${normalized_sha}" \
    "${candidate_config_digest}"
fi

write_image_env "${new_api_image}" "${new_web_image}"
active_compose_file="${candidate_compose_file}"

deployment_ready=false
if compose up \
  --detach \
  --no-build \
  --pull never \
  --remove-orphans \
  --wait \
  --wait-timeout "${HEALTH_TIMEOUT_SECONDS}"
then
  if running_service_set_is_complete; then
    deployment_ready=true
  else
    printf 'Guess Pokémon deployment did not start every required service\n' >&2
  fi
fi

if [[ "${deployment_ready}" == true ]]; then
  if [[ "${legacy_mode}" == false ]]; then
    write_success_state \
      "${normalized_sha}" \
      "${candidate_config_digest}" \
      "${candidate_config_revision}" \
      "${candidate_config_content_sha}" \
      "${previous_sha:-${ZERO_SHA}}" \
      "${previous_config_digest}" \
      "${candidate_release}"
  fi
  printf 'Guess Pokémon deployment succeeded: %s\n' "${normalized_sha}"
  exit 0
fi

printf 'Guess Pokémon deployment failed for commit: %s\n' "${normalized_sha}" >&2
compose logs --tail 100 api web >&2 || true

if [[ -n "${previous_sha}" ]]; then
  previous_api_image="${API_IMAGE_REPOSITORY}:${previous_sha}"
  previous_web_image="${WEB_IMAGE_REPOSITORY}:${previous_sha}"

  printf 'Rolling back application images to: %s\n' "${previous_sha}" >&2
  write_image_env "${previous_api_image}" "${previous_web_image}"
  active_compose_file="${current_compose_file}"

  if compose up \
    --detach \
    --no-build \
    --pull never \
    --remove-orphans \
    --wait \
    --wait-timeout "${HEALTH_TIMEOUT_SECONDS}" \
    && running_service_set_is_complete
  then
    if [[ "${legacy_mode}" == false ]]; then
      /bin/rm -f -- "${RUNTIME_CONFIG_PENDING}"
    fi
    printf 'Application image rollback succeeded: %s\n' "${previous_sha}" >&2
  else
    printf 'Application image rollback failed: %s\n' "${previous_sha}" >&2
    compose logs --tail 100 api web >&2 || true
  fi
else
  printf 'No previous SHA image exists; keeping the database and stopping failed app containers\n' >&2
  write_image_env "${current_api_image}" "${current_web_image}"
  active_compose_file="${current_compose_file}"
  if compose stop api web; then
    if [[ "${legacy_mode}" == false ]]; then
      /bin/rm -f -- "${RUNTIME_CONFIG_PENDING}"
    fi
  else
    printf 'Application bootstrap teardown failed; pending transaction retained\n' >&2
  fi
fi

printf 'Database migration is not rolled back automatically\n' >&2
exit 1
