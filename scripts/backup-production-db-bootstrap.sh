#!/bin/bash

set -Eeuo pipefail

readonly LOCKF_BIN=/usr/bin/lockf
readonly PYTHON_BIN=/usr/bin/python3
readonly APP_DIR=/Users/homeserver/Server/apps/guess-pokemon
readonly LEGACY_BACKUP_SCRIPT=/Users/homeserver/Server/scripts/backup/backup-guess-pokemon.sh
readonly RUNTIME_CONFIG_ROOT="${APP_DIR}/runtime-config"
readonly RUNTIME_CONFIG_RELEASES="${RUNTIME_CONFIG_ROOT}/releases"
readonly RUNTIME_CONFIG_STATE="${RUNTIME_CONFIG_ROOT}/state"
readonly RUNTIME_CONFIG_PENDING="${RUNTIME_CONFIG_ROOT}/pending"
readonly RUNTIME_CONFIG_CURRENT="${RUNTIME_CONFIG_ROOT}/current"
readonly RUNTIME_CONFIG_INITIALIZED="${APP_DIR}/.runtime-config-v2-initialized"
readonly OPERATION_LOCK="${APP_DIR}/.guess-pokemon-operation.lock"
readonly ZERO_SHA=0000000000000000000000000000000000000000
readonly ZERO_DIGEST=sha256:0000000000000000000000000000000000000000000000000000000000000000

fail() {
  printf 'Guess Pokémon backup bootstrap failed: %s\n' "$1" >&2
  exit 1
}

acquire_operation_lock() {
  local lock_status

  if [[ ! -x "${PYTHON_BIN}" ]]; then
    fail "Python is not executable: ${PYTHON_BIN}"
  fi
  if [[ ! -x "${LOCKF_BIN}" ]]; then
    fail "lockf is not executable: ${LOCKF_BIN}"
  fi
  if [[ -L "${OPERATION_LOCK}" ]] \
    || { [[ -e "${OPERATION_LOCK}" ]] && [[ ! -f "${OPERATION_LOCK}" ]]; }
  then
    fail "operation lock path must be a regular non-symlink file"
  fi

  umask 077
  if ! exec 9>>"${OPERATION_LOCK}"; then
    fail "operation lock file could not be opened"
  fi

  /bin/chmod 600 "${OPERATION_LOCK}"
  if "${LOCKF_BIN}" -s -t 0 9
  then
    return
  else
    lock_status="$?"
  fi

  exec 9>&-
  if [[ "${lock_status}" -eq 75 ]]; then
    printf 'Another Guess Pokémon deploy or backup operation is already running\n' >&2
    exit 75
  fi
  fail "operation lock validation failed"
}

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
  local previous_digest
  local previous_revision
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

validate_initialization_marker() {
  if [[ ! -f "${RUNTIME_CONFIG_INITIALIZED}" ]] \
    || [[ -L "${RUNTIME_CONFIG_INITIALIZED}" ]] \
    || [[ "$(/bin/cat "${RUNTIME_CONFIG_INITIALIZED}")" != RUNTIME_CONFIG_V2=initialized ]]
  then
    fail "runtime config initialization marker is invalid"
  fi
}

release_shape() {
  local entries
  local release_dir="$1"
  local unexpected

  if [[ ! -d "${release_dir}" || -L "${release_dir}" ]]; then
    fail "runtime config release is missing or unsafe"
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
    printf 'legacy'
    return
  fi
  if [[ "${entries}" == $'compose.yaml\ninfra\ninfra/nginx\ninfra/nginx/cloudflare-edge-real-ip.conf\nscripts\nscripts/backup-guess-pokemon.sh\nscripts/deploy-guess-pokemon.sh' ]]; then
    printf 'synced'
    return
  fi
  fail "runtime config entry allowlist does not match"
}

validate_synced_scripts() {
  local release_dir="$1"
  local script

  for script in \
    "${release_dir}/scripts/backup-guess-pokemon.sh" \
    "${release_dir}/scripts/deploy-guess-pokemon.sh"
  do
    if [[ ! -x "${script}" || -L "${script}" ]]; then
      fail "runtime config script is missing, unsafe, or not executable"
    fi
    if ! "${PYTHON_BIN}" -c \
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
  local shape="$2"

  {
    /usr/bin/shasum -a 256 "${release_dir}/compose.yaml"
    /usr/bin/shasum -a 256 \
      "${release_dir}/infra/nginx/cloudflare-edge-real-ip.conf"
    if [[ "${shape}" == synced ]]; then
      /usr/bin/shasum -a 256 \
        "${release_dir}/scripts/backup-guess-pokemon.sh"
      /usr/bin/shasum -a 256 \
        "${release_dir}/scripts/deploy-guess-pokemon.sh"
    fi
  } | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}'
}

if [[ "$#" -ne 0 ]]; then
  printf 'Usage: backup-production-db-bootstrap.sh\n' >&2
  exit 64
fi
acquire_operation_lock
if [[ -e "${RUNTIME_CONFIG_PENDING}" || -L "${RUNTIME_CONFIG_PENDING}" ]]; then
  fail "an incomplete runtime config transaction requires recovery"
fi

if [[ ! -e "${RUNTIME_CONFIG_STATE}" && ! -L "${RUNTIME_CONFIG_STATE}" ]]; then
  if [[ -e "${RUNTIME_CONFIG_CURRENT}" || -L "${RUNTIME_CONFIG_CURRENT}" ]] \
    || [[ -e "${RUNTIME_CONFIG_INITIALIZED}" || -L "${RUNTIME_CONFIG_INITIALIZED}" ]]
  then
    fail "runtime config pointer or marker exists without verified state"
  fi
  exec "${LEGACY_BACKUP_SCRIPT}"
fi

validate_initialization_marker
validate_state_file
runtime_digest="$(read_state_value RUNTIME_CONFIG_DIGEST)"
expected_content_sha="$(read_state_value RUNTIME_CONFIG_CONTENT_SHA256)"
release_dir="${RUNTIME_CONFIG_RELEASES}/${runtime_digest#sha256:}"
expected_current_target="releases/${runtime_digest#sha256:}"

if [[ ! -L "${RUNTIME_CONFIG_CURRENT}" ]] \
  || [[ "$(/usr/bin/readlink "${RUNTIME_CONFIG_CURRENT}")" != "${expected_current_target}" ]]
then
  fail "runtime config current pointer does not match verified state"
fi

shape="$(release_shape "${release_dir}")"
if [[ "$(runtime_config_content_sha256 "${release_dir}" "${shape}")" != "${expected_content_sha}" ]]; then
  fail "runtime config release integrity check failed"
fi
if [[ "${shape}" == legacy ]]; then
  exec "${LEGACY_BACKUP_SCRIPT}"
fi

validate_synced_scripts "${release_dir}"
exec "${release_dir}/scripts/backup-guess-pokemon.sh"
