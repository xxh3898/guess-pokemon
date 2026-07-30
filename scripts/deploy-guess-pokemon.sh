#!/bin/bash

set -Eeuo pipefail

readonly DOCKER_BIN=/usr/local/bin/docker
readonly PYTHON_BIN=/usr/bin/python3
readonly APP_DIR=/Users/homeserver/Server/apps/guess-pokemon
readonly LEGACY_COMPOSE_FILE="${APP_DIR}/compose.yaml"
readonly ENV_FILE="${APP_DIR}/.env"
readonly BACKUP_SCRIPT=/Users/homeserver/Server/scripts/backup/backup-guess-pokemon.sh
readonly RUNTIME_CONFIG_ROOT="${APP_DIR}/runtime-config"
readonly RUNTIME_CONFIG_RELEASES="${RUNTIME_CONFIG_ROOT}/releases"
readonly RUNTIME_CONFIG_STATE="${RUNTIME_CONFIG_ROOT}/state"
readonly RUNTIME_CONFIG_PENDING="${RUNTIME_CONFIG_ROOT}/pending"
readonly RUNTIME_CONFIG_CURRENT="${RUNTIME_CONFIG_ROOT}/current"
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

if [[ ! -f "${LEGACY_COMPOSE_FILE}" || ! -f "${ENV_FILE}" ]]; then
  fail "production Compose configuration is incomplete"
fi

if [[ "${recovery_mode}" == false && -e "${RUNTIME_CONFIG_PENDING}" ]]; then
  fail "an incomplete runtime config transaction requires recovery"
fi
if [[ "${legacy_mode}" == true && -e "${RUNTIME_CONFIG_STATE}" ]]; then
  fail "legacy deployment is disabled after runtime config state initialization"
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
    "${current_link_temp}"
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
  local rendered

  API_IMAGE="${api_image}" \
  WEB_IMAGE="${web_image}" \
    "${DOCKER_BIN}" \
      compose \
      --project-directory "$(/usr/bin/dirname "${compose_file}")" \
      --env-file "${ENV_FILE}" \
      --file "${compose_file}" \
      config \
      --quiet

  rendered="$(
    API_IMAGE="${api_image}" \
    WEB_IMAGE="${web_image}" \
      "${DOCKER_BIN}" \
        compose \
        --project-directory "$(/usr/bin/dirname "${compose_file}")" \
        --env-file "${ENV_FILE}" \
        --file "${compose_file}" \
        config \
        --format json
  )"

  printf '%s' "${rendered}" \
    | "${PYTHON_BIN}" -c '
import json
import sys

config = json.load(sys.stdin)
expected_api_image, expected_web_image, expected_real_ip_source = sys.argv[1:4]
services = config.get("services", {})
networks = config.get("networks", {})
volumes = config.get("volumes", {})
if config.get("name") != "guess-pokemon":
    raise SystemExit("Compose project name must remain guess-pokemon")
if set(services) != {"db", "api", "web"}:
    raise SystemExit("unexpected Guess Pokemon service set")
expected = {
    "db": {"application"},
    "api": {"application", "egress"},
    "web": {"application", "edge"},
}
for name, expected_networks in expected.items():
    service = services[name]
    if set(service.get("networks", {})) != expected_networks:
        raise SystemExit(f"{name} network contract is invalid")
    if service.get("ports"):
        raise SystemExit(f"{name} must not publish host ports")
if services["api"].get("image") != expected_api_image:
    raise SystemExit("API image does not match the requested deployment")
if services["web"].get("image") != expected_web_image:
    raise SystemExit("Web image does not match the requested deployment")
if networks.get("application", {}).get("internal") is not True:
    raise SystemExit("application network must be internal")
edge = networks.get("edge", {})
if edge.get("external") is not True or edge.get("name") != "edge":
    raise SystemExit("edge network contract is invalid")
if networks.get("egress", {}).get("internal") is True:
    raise SystemExit("egress network must permit outbound access")
db_volumes = services["db"].get("volumes", [])
db_data = next(
    (
        volume
        for volume in db_volumes
        if isinstance(volume, dict)
        and volume.get("target") == "/var/lib/postgresql"
    ),
    None,
)
if (
    not db_data
    or db_data.get("type") != "volume"
    or db_data.get("source") != "postgres-data"
    or volumes.get("postgres-data", {}).get("name")
    != "guess-pokemon_postgres-data"
):
    raise SystemExit("PostgreSQL persistent volume contract is invalid")
web_volumes = services["web"].get("volumes", [])
if not any(
    volume.get("target") == "/etc/nginx/conf.d/00-cloudflare-real-ip.conf"
    and volume.get("read_only") is True
    and volume.get("source") == expected_real_ip_source
    for volume in web_volumes
    if isinstance(volume, dict)
):
    raise SystemExit("pinned Cloudflare real-IP bind is missing")
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
  [[ "${services}" == $'api\ndb\nweb' ]]
}

recover_pending_transaction() {
  local previous_sha
  local previous_digest
  local target_sha
  local target_digest
  local state_sha
  local state_digest
  local state_content_sha
  local recovery_release
  local recovery_api_image
  local recovery_web_image
  local expected_current

  validate_pending_state
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

  if [[ "${state_sha}" == "${target_sha}" && "${state_digest}" == "${target_digest}" ]]; then
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
      "${recovery_web_image}"
    if ! running_service_set_is_complete; then
      fail "completed target services are not all running"
    fi

    expected_current="releases/$("/usr/bin/basename" "${recovery_release}")"
    if [[ ! -L "${RUNTIME_CONFIG_CURRENT}" ]] \
      || [[ "$(/usr/bin/readlink "${RUNTIME_CONFIG_CURRENT}")" != "${expected_current}" ]]
    then
      replace_current_link "${recovery_release}"
    fi
    /bin/rm -f -- "${RUNTIME_CONFIG_PENDING}"
    printf 'Completed Guess Pokémon runtime config transaction finalized: %s\n' "${target_sha}"
    return 0
  fi

  if [[ "${previous_sha}" == "${ZERO_SHA}" ]]; then
    if [[ -n "${state_sha}" || "${previous_digest}" != "${ZERO_DIGEST}" ]]; then
      fail "bootstrap recovery state is inconsistent"
    fi
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

  if [[ -e "${RUNTIME_CONFIG_STATE}" ]] \
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

  if [[ "${current_config_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] \
    && [[ "${current_config_digest}" != "${ZERO_DIGEST}" ]]
  then
    current_release="$(release_dir_for_digest "${current_config_digest}")"
    current_compose_file="${current_release}/compose.yaml"
  else
    current_release=
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
  "${new_web_image}"

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

if compose up \
  --detach \
  --no-build \
  --pull never \
  --remove-orphans \
  --wait \
  --wait-timeout "${HEALTH_TIMEOUT_SECONDS}"
then
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
    --wait-timeout "${HEALTH_TIMEOUT_SECONDS}"
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
