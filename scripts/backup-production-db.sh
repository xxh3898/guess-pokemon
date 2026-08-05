#!/bin/bash

set -Eeuo pipefail

umask 077

readonly DOCKER_BIN=/usr/local/bin/docker
readonly PYTHON_BIN=/usr/bin/python3
readonly HOMEOPS_EVENT_REPORTER=/Users/homeserver/Server/apps/homeops/runtime-config/current/scripts/report-homeops-event.py
readonly APP_DIR=/Users/homeserver/Server/apps/guess-pokemon
readonly PROJECT_NAME=guess-pokemon
readonly LEGACY_COMPOSE_FILE="${APP_DIR}/compose.yaml"
readonly ENV_FILE="${APP_DIR}/.env"
readonly BACKUP_DIR=/Users/homeserver/Server/backups/guess-pokemon/data
readonly RUNTIME_CONFIG_ROOT="${APP_DIR}/runtime-config"
readonly RUNTIME_CONFIG_RELEASES="${RUNTIME_CONFIG_ROOT}/releases"
readonly RUNTIME_CONFIG_STATE="${RUNTIME_CONFIG_ROOT}/state"
readonly RUNTIME_CONFIG_CURRENT="${RUNTIME_CONFIG_ROOT}/current"
readonly RUNTIME_CONFIG_INITIALIZED="${APP_DIR}/.runtime-config-v2-initialized"
readonly ZERO_SHA=0000000000000000000000000000000000000000
readonly ZERO_DIGEST=sha256:0000000000000000000000000000000000000000000000000000000000000000
readonly RETENTION_SECONDS=$((3 * 24 * 60 * 60))

temporary_file=
final_file=
active_compose_file=
homeops_backup_started_at=
homeops_backup_event_key=

report_homeops_backup() {
  local status="$1"
  local finished_at="$2"
  local logical_location="${3:-}"
  local size_bytes="${4:-}"
  local payload

  if [[ -z "${homeops_backup_event_key}" ]]; then
    return
  fi
  if [[ ! -f "${HOMEOPS_EVENT_REPORTER}" || -L "${HOMEOPS_EVENT_REPORTER}" || ! -x "${HOMEOPS_EVENT_REPORTER}" ]]; then
    printf 'HomeOps backup event reporter is unavailable\n' >&2
    return
  fi
  payload="$(
    "${PYTHON_BIN}" - \
      "${homeops_backup_event_key}" "${status}" "${homeops_backup_started_at}" \
      "${finished_at}" "${logical_location}" "${size_bytes}" <<'PY'
import json, sys
event_key, status, started_at, finished_at, logical_location, size_bytes = sys.argv[1:]
print(json.dumps({
    "eventKey": event_key,
    "project": "guess-pokemon",
    "databaseType": "POSTGRESQL",
    "logicalLocation": logical_location or None,
    "status": status,
    "startedAt": started_at,
    "finishedAt": finished_at or None,
    "sizeBytes": int(size_bytes) if size_bytes else None,
    "failureSummary": "backup worker exited unsuccessfully" if status == "FAILED" else None,
}, separators=(",", ":")))
PY
  )" || {
    printf 'HomeOps backup event payload could not be generated\n' >&2
    return
  }
  if ! printf '%s' "${payload}" | "${HOMEOPS_EVENT_REPORTER}" backups; then
    printf 'HomeOps backup event could not be retained\n' >&2
  fi
}

fail() {
  printf 'Guess Pokémon DB backup failed: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  local exit_status="$?"
  local finished_at
  local logical_location=
  local size_bytes=

  if [[ -n "${homeops_backup_event_key}" ]]; then
    finished_at="$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')"
    if [[ "${exit_status}" -eq 0 && -n "${final_file}" && -f "${final_file}" ]]; then
      logical_location="guess-pokemon/data/$(/usr/bin/basename "${final_file}")"
      size_bytes="$(/usr/bin/stat -f '%z' "${final_file}")"
      report_homeops_backup SUCCESS "${finished_at}" "${logical_location}" "${size_bytes}"
    else
      report_homeops_backup FAILED "${finished_at}" "" ""
    fi
  fi
  if [[ -n "${temporary_file}" && -f "${temporary_file}" ]]; then
    /bin/unlink "${temporary_file}"
  fi
  return "${exit_status}"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

is_digest() {
  [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]] && [[ "$1" != "${ZERO_DIGEST}" ]]
}

read_state_value() {
  local key="$1"

  /usr/bin/sed -n "s/^${key}=//p" "${RUNTIME_CONFIG_STATE}" \
    | /usr/bin/tail -n 1
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

validate_release_files() {
  local release_dir="$1"
  local entries
  local unexpected

  if [[ ! -d "${release_dir}" || -L "${release_dir}" ]]; then
    fail "verified runtime config release is missing or unsafe"
  fi

  unexpected="$(
    /usr/bin/find "${release_dir}" ! -type d ! -type f -print
  )"
  if [[ -n "${unexpected}" ]]; then
    fail "runtime config contains unsupported file types"
  fi

  entries="$(
    /usr/bin/find "${release_dir}" -mindepth 1 -print \
      | /usr/bin/sed "s#^${release_dir}/##" \
      | LC_ALL=C /usr/bin/sort
  )"
  if [[ "${entries}" == $'compose.yaml\ninfra\ninfra/nginx\ninfra/nginx/cloudflare-edge-real-ip.conf' ]]; then
    return
  fi
  if [[ "${entries}" != $'compose.yaml\ninfra\ninfra/nginx\ninfra/nginx/cloudflare-edge-real-ip.conf\nscripts\nscripts/backup-guess-pokemon.sh\nscripts/deploy-guess-pokemon.sh' ]]; then
    fail "runtime config file allowlist does not match"
  fi
  validate_release_scripts "${release_dir}"
}

release_has_synced_scripts() {
  local release_dir="$1"

  [[ -f "${release_dir}/scripts/backup-guess-pokemon.sh" ]] \
    && [[ ! -L "${release_dir}/scripts/backup-guess-pokemon.sh" ]] \
    && [[ -f "${release_dir}/scripts/deploy-guess-pokemon.sh" ]] \
    && [[ ! -L "${release_dir}/scripts/deploy-guess-pokemon.sh" ]]
}

validate_release_scripts() {
  local release_dir="$1"
  local script

  for script in \
    "${release_dir}/scripts/backup-guess-pokemon.sh" \
    "${release_dir}/scripts/deploy-guess-pokemon.sh"
  do
    if [[ ! -x "${script}" ]]; then
      fail "runtime config script is not executable"
    fi
    if ! /usr/bin/python3 -c \
      'import os, stat, sys; raise SystemExit(0 if stat.S_IMODE(os.stat(sys.argv[1]).st_mode) == 0o700 else 1)' \
      "${script}"
    then
      fail "runtime config script mode must be 700"
    fi
    if ! /bin/bash -n "${script}"; then
      fail "runtime config script syntax is invalid"
    fi
  done
}

runtime_config_content_sha256() {
  local release_dir="$1"

  {
    /usr/bin/shasum -a 256 "${release_dir}/compose.yaml"
    /usr/bin/shasum -a 256 \
      "${release_dir}/infra/nginx/cloudflare-edge-real-ip.conf"
    if release_has_synced_scripts "${release_dir}"; then
      /usr/bin/shasum -a 256 \
        "${release_dir}/scripts/backup-guess-pokemon.sh"
      /usr/bin/shasum -a 256 \
        "${release_dir}/scripts/deploy-guess-pokemon.sh"
    fi
  } | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}'
}

validate_initialization_marker() {
  if [[ ! -f "${RUNTIME_CONFIG_INITIALIZED}" ]] \
    || [[ -L "${RUNTIME_CONFIG_INITIALIZED}" ]] \
    || [[ "$(/bin/cat "${RUNTIME_CONFIG_INITIALIZED}")" != RUNTIME_CONFIG_V2=initialized ]]
  then
    fail "runtime config initialization marker is invalid"
  fi
}

select_compose_file() {
  local current_target
  local expected_current_target
  local release_dir
  local runtime_content_sha
  local runtime_digest

  if [[ ! -e "${RUNTIME_CONFIG_STATE}" && ! -L "${RUNTIME_CONFIG_STATE}" ]]; then
    if [[ -e "${RUNTIME_CONFIG_CURRENT}" || -L "${RUNTIME_CONFIG_CURRENT}" ]]; then
      fail "runtime config current pointer exists without verified state"
    fi
    if [[ -e "${RUNTIME_CONFIG_INITIALIZED}" || -L "${RUNTIME_CONFIG_INITIALIZED}" ]]; then
      validate_initialization_marker
      fail "initialized runtime config state is missing"
    fi
    if [[ ! -f "${LEGACY_COMPOSE_FILE}" || -L "${LEGACY_COMPOSE_FILE}" ]]; then
      fail "legacy production Compose configuration is missing or unsafe"
    fi
    printf '%s' "${LEGACY_COMPOSE_FILE}"
    return
  fi

  if [[ ! -e "${RUNTIME_CONFIG_INITIALIZED}" && ! -L "${RUNTIME_CONFIG_INITIALIZED}" ]]; then
    fail "runtime config state exists without initialization marker"
  fi
  validate_initialization_marker
  validate_state_file
  runtime_digest="$(read_state_value RUNTIME_CONFIG_DIGEST)"
  runtime_content_sha="$(read_state_value RUNTIME_CONFIG_CONTENT_SHA256)"
  release_dir="${RUNTIME_CONFIG_RELEASES}/${runtime_digest#sha256:}"
  expected_current_target="releases/${runtime_digest#sha256:}"

  if [[ ! -L "${RUNTIME_CONFIG_CURRENT}" ]]; then
    fail "verified runtime config current pointer is missing"
  fi
  current_target="$(/usr/bin/readlink "${RUNTIME_CONFIG_CURRENT}")"
  if [[ "${current_target}" != "${expected_current_target}" ]]; then
    fail "runtime config current pointer does not match verified state"
  fi

  validate_release_files "${release_dir}"
  if [[ "$(runtime_config_content_sha256 "${release_dir}")" != "${runtime_content_sha}" ]]; then
    fail "runtime config release integrity check failed"
  fi

  printf '%s/compose.yaml' "${release_dir}"
}

if [[ ! -x "${DOCKER_BIN}" ]]; then
  fail "Docker CLI is not executable: ${DOCKER_BIN}"
fi
if [[ ! -x "${PYTHON_BIN}" ]]; then
  fail "Python is not executable: ${PYTHON_BIN}"
fi

if [[ ! -f "${ENV_FILE}" || -L "${ENV_FILE}" ]]; then
  fail "production environment configuration is missing or unsafe"
fi

active_compose_file="$(select_compose_file)"
/bin/mkdir -p "${BACKUP_DIR}"

compose() {
  "${DOCKER_BIN}" \
    compose \
    --project-name "${PROJECT_NAME}" \
    --project-directory "$(/usr/bin/dirname "${active_compose_file}")" \
    --env-file "${ENV_FILE}" \
    --file "${active_compose_file}" \
    "$@"
}

running_services="$(compose ps --status running --services)"
if ! /usr/bin/grep -qx db <<<"${running_services}"; then
  fail "production db service is not running"
fi

timestamp="$(/bin/date -u '+%Y%m%dT%H%M%SZ')"
homeops_backup_started_at="$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')"
homeops_backup_event_key="guess-pokemon:backup:${timestamp}"
report_homeops_backup RUNNING "" "guess-pokemon/data/guess-pokemon-production-${timestamp}.dump" ""
final_file="${BACKUP_DIR}/guess-pokemon-production-${timestamp}.dump"
temporary_file="$(
  /usr/bin/mktemp "${BACKUP_DIR}/.guess-pokemon-backup.XXXXXX"
)"

# Variables expand inside the database container, not in this host shell.
# shellcheck disable=SC2016
compose exec -T db /bin/sh -ceu '
  exec pg_dump \
    --format=custom \
    --no-owner \
    --no-privileges \
    --username "${POSTGRES_USER}" \
    --dbname "${POSTGRES_DB}"
' >"${temporary_file}"

if [[ ! -s "${temporary_file}" ]]; then
  fail "generated archive is empty"
fi

compose exec -T db pg_restore --list <"${temporary_file}" >/dev/null

if ! /bin/ln "${temporary_file}" "${final_file}"; then
  fail "archive with the same name already exists"
fi

/bin/unlink "${temporary_file}"
temporary_file=

now_epoch="$(/bin/date '+%s')"
for candidate in "${BACKUP_DIR}"/guess-pokemon-production-*.dump; do
  if [[ ! -f "${candidate}" || "${candidate}" == "${final_file}" ]]; then
    continue
  fi

  candidate_name="$(/usr/bin/basename "${candidate}")"
  if [[ ! "${candidate_name}" =~ ^guess-pokemon-production-[0-9]{8}T[0-9]{6}Z\.dump$ ]]; then
    continue
  fi

  modified_epoch="$(/usr/bin/stat -f '%m' "${candidate}")"
  age_seconds=$((now_epoch - modified_epoch))

  if ((age_seconds > RETENTION_SECONDS)); then
    /bin/unlink "${candidate}"
    printf 'Expired backup removed: %s\n' "${candidate}"
  fi
done

printf 'Backup completed: %s\n' "${final_file}"
