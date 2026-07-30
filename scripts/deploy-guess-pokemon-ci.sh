#!/bin/bash

set -Eeuo pipefail

readonly DOCKER_BIN=/usr/local/bin/docker
readonly LOCKF_BIN=/usr/bin/lockf
readonly PYTHON_BIN=/usr/bin/python3
readonly APP_DIR=/Users/homeserver/Server/apps/guess-pokemon
readonly LEGACY_DEPLOY_SCRIPT=/Users/homeserver/Server/scripts/deploy/deploy-guess-pokemon.sh
readonly RUNTIME_CONFIG_ROOT="${APP_DIR}/runtime-config"
readonly RUNTIME_CONFIG_RELEASES="${RUNTIME_CONFIG_ROOT}/releases"
readonly RUNTIME_CONFIG_STATE="${RUNTIME_CONFIG_ROOT}/state"
readonly RUNTIME_CONFIG_PENDING="${RUNTIME_CONFIG_ROOT}/pending"
readonly RUNTIME_CONFIG_CURRENT="${RUNTIME_CONFIG_ROOT}/current"
readonly RUNTIME_CONFIG_INITIALIZED="${APP_DIR}/.runtime-config-v2-initialized"
readonly OPERATION_LOCK="${APP_DIR}/.guess-pokemon-operation.lock"
readonly RUNTIME_CONFIG_REPOSITORY=ghcr.io/xxh3898/guess-pokemon-runtime-config
readonly ZERO_SHA=0000000000000000000000000000000000000000
readonly ZERO_DIGEST=sha256:0000000000000000000000000000000000000000000000000000000000000000

fail() {
  printf 'Guess Pokémon deploy bootstrap failed: %s\n' "$1" >&2
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

validate_release() {
  local expected_shape="${2:-either}"
  local release_dir="$1"
  local shape

  shape="$(release_shape "${release_dir}")"
  if [[ "${expected_shape}" != either && "${shape}" != "${expected_shape}" ]]; then
    fail "runtime config release shape is not ${expected_shape}"
  fi
  if [[ "${shape}" == synced ]]; then
    validate_synced_scripts "${release_dir}"
  fi
  printf '%s' "${shape}"
}

runtime_config_content_sha256() {
  local release_dir="$1"
  local shape

  shape="$(validate_release "${release_dir}")"
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

validate_verified_state() {
  local current_target
  local expected_content_sha
  local expected_current_target
  local release_dir
  local runtime_digest

  if [[ ! -e "${RUNTIME_CONFIG_STATE}" && ! -L "${RUNTIME_CONFIG_STATE}" ]]; then
    if [[ -e "${RUNTIME_CONFIG_CURRENT}" || -L "${RUNTIME_CONFIG_CURRENT}" ]] \
      || [[ -e "${RUNTIME_CONFIG_INITIALIZED}" || -L "${RUNTIME_CONFIG_INITIALIZED}" ]]
    then
      fail "runtime config pointer or marker exists without verified state"
    fi
    return
  fi

  validate_initialization_marker
  validate_state_file
  runtime_digest="$(read_state_value RUNTIME_CONFIG_DIGEST)"
  expected_content_sha="$(read_state_value RUNTIME_CONFIG_CONTENT_SHA256)"
  release_dir="${RUNTIME_CONFIG_RELEASES}/${runtime_digest#sha256:}"
  expected_current_target="releases/${runtime_digest#sha256:}"

  if [[ ! -L "${RUNTIME_CONFIG_CURRENT}" ]]; then
    fail "verified runtime config current pointer is missing"
  fi
  current_target="$(/usr/bin/readlink "${RUNTIME_CONFIG_CURRENT}")"
  if [[ "${current_target}" != "${expected_current_target}" ]]; then
    fail "runtime config current pointer does not match verified state"
  fi
  validate_release "${release_dir}" >/dev/null
  if [[ "$(runtime_config_content_sha256 "${release_dir}")" != "${expected_content_sha}" ]]; then
    fail "runtime config release integrity check failed"
  fi

  printf '%s' "${release_dir}"
}

validated_recovery_release() {
  local expected_content_sha
  local release_dir
  local runtime_digest

  if [[ ! -e "${RUNTIME_CONFIG_STATE}" && ! -L "${RUNTIME_CONFIG_STATE}" ]]; then
    return
  fi
  validate_state_file
  if [[ -e "${RUNTIME_CONFIG_INITIALIZED}" || -L "${RUNTIME_CONFIG_INITIALIZED}" ]]; then
    validate_initialization_marker
  fi
  runtime_digest="$(read_state_value RUNTIME_CONFIG_DIGEST)"
  expected_content_sha="$(read_state_value RUNTIME_CONFIG_CONTENT_SHA256)"
  release_dir="${RUNTIME_CONFIG_RELEASES}/${runtime_digest#sha256:}"
  validate_release "${release_dir}" >/dev/null
  if [[ "$(runtime_config_content_sha256 "${release_dir}")" != "${expected_content_sha}" ]]; then
    fail "runtime config release integrity check failed"
  fi
  printf '%s' "${release_dir}"
}

if [[ "$#" -eq 1 && "$1" == recover && -z "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  acquire_operation_lock
  recovery_release="$(validated_recovery_release)"
  if [[ -n "${recovery_release}" ]] \
    && [[ "$(validate_release "${recovery_release}")" == synced ]]
  then
    exec "${recovery_release}/scripts/deploy-guess-pokemon.sh" recover
  fi
  exec "${LEGACY_DEPLOY_SCRIPT}" recover
fi

if [[ "$#" -ne 0 ]]; then
  printf 'Only a direct local recover argument is allowed\n' >&2
  exit 64
fi

original_command="${SSH_ORIGINAL_COMMAND:-}"
if [[ "${original_command}" =~ ^deploy-guess-pokemon[[:space:]]([0-9a-fA-F]{40})[[:space:]]([A-Za-z0-9_-]+)$ ]]; then
  acquire_operation_lock
  exec "${LEGACY_DEPLOY_SCRIPT}" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
fi

config_mode=
config_digest=
commit_sha=
registry_user=

if [[ "${original_command}" =~ ^deploy-guess-pokemon-v2[[:space:]]([0-9a-f]{40})[[:space:]]keep[[:space:]]([A-Za-z0-9_-]+)$ ]]; then
  commit_sha="${BASH_REMATCH[1]}"
  config_mode=keep
  registry_user="${BASH_REMATCH[2]}"
elif [[ "${original_command}" =~ ^deploy-guess-pokemon-v2[[:space:]]([0-9a-f]{40})[[:space:]]update[[:space:]](sha256:[0-9a-f]{64})[[:space:]]([A-Za-z0-9_-]+)$ ]]; then
  commit_sha="${BASH_REMATCH[1]}"
  config_mode=update
  config_digest="${BASH_REMATCH[2]}"
  registry_user="${BASH_REMATCH[3]}"
else
  printf '%s\n' \
    'Only deploy-guess-pokemon or strictly formatted deploy-guess-pokemon-v2 commands are allowed' \
    >&2
  exit 64
fi

if [[ "${config_mode}" == update ]] && ! is_digest "${config_digest}"; then
  printf 'Runtime config digest is invalid\n' >&2
  exit 64
fi
acquire_operation_lock
if [[ ! -x "${DOCKER_BIN}" ]]; then
  fail "Docker CLI is not executable: ${DOCKER_BIN}"
fi
if [[ -e "${RUNTIME_CONFIG_PENDING}" || -L "${RUNTIME_CONFIG_PENDING}" ]]; then
  fail "an incomplete runtime config transaction requires recovery"
fi

current_release="$(validate_verified_state)"
if [[ "${config_mode}" == keep ]]; then
  if [[ -z "${current_release}" ]] \
    || [[ "$(validate_release "${current_release}")" != synced ]]
  then
    fail "keep mode requires a verified script-enabled runtime config release"
  fi
  candidate_release="${current_release}"
fi

registry_token="$(/bin/cat)"
if [[ -z "${registry_token}" ]]; then
  printf 'GHCR token must not be empty\n' >&2
  exit 64
fi

umask 077

docker_config_dir=
token_file=
release_temp=
config_container_id=
logged_in=false

cleanup() {
  registry_token=

  if [[ -n "${config_container_id}" ]]; then
    "${DOCKER_BIN}" rm "${config_container_id}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${release_temp}" && -d "${release_temp}" ]] \
    && [[ "$(/usr/bin/basename "${release_temp}")" == .tmp.* ]]
  then
    /bin/rm -rf -- "${release_temp}"
  fi
  if [[ "${logged_in}" == true && -n "${docker_config_dir}" ]]; then
    "${DOCKER_BIN}" \
      --config "${docker_config_dir}" \
      logout ghcr.io \
      >/dev/null 2>&1 \
      || true
  fi
  if [[ -n "${docker_config_dir}" && -d "${docker_config_dir}" ]] \
    && [[ "$(/usr/bin/basename "${docker_config_dir}")" == guess-pokemon-bootstrap-docker.* ]]
  then
    /bin/rm -rf -- "${docker_config_dir}"
  fi
  if [[ -n "${token_file}" && -f "${token_file}" ]] \
    && [[ "$(/usr/bin/basename "${token_file}")" == guess-pokemon-token.* ]]
  then
    /bin/rm -f -- "${token_file}"
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "${config_mode}" == update ]]; then
  config_image="${RUNTIME_CONFIG_REPOSITORY}@${config_digest}"
  docker_config_dir="$(
    /usr/bin/mktemp -d "${TMPDIR:-/tmp}/guess-pokemon-bootstrap-docker.XXXXXX"
  )"
  printf '%s' "${registry_token}" \
    | "${DOCKER_BIN}" \
        --config "${docker_config_dir}" \
        login ghcr.io \
        --username "${registry_user}" \
        --password-stdin \
        >/dev/null
  logged_in=true

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
  if [[ "${actual_revision}" != "${commit_sha}" ]]; then
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
  candidate_release="${RUNTIME_CONFIG_RELEASES}/${config_digest#sha256:}"
  release_temp="$(
    /usr/bin/mktemp -d "${RUNTIME_CONFIG_RELEASES}/.tmp.XXXXXX"
  )"
  config_container_id="$("${DOCKER_BIN}" create "${config_image}")"
  "${DOCKER_BIN}" cp "${config_container_id}:/runtime/." "${release_temp}"
  "${DOCKER_BIN}" rm "${config_container_id}" >/dev/null
  config_container_id=

  validate_release "${release_temp}" synced >/dev/null
  /bin/chmod -R go-rwx "${release_temp}"
  validate_release "${release_temp}" synced >/dev/null

  if [[ -d "${candidate_release}" ]]; then
    validate_release "${candidate_release}" synced >/dev/null
    if ! /usr/bin/diff -qr "${release_temp}" "${candidate_release}" >/dev/null; then
      fail "existing runtime config release differs from exact digest artifact"
    fi
    /bin/rm -rf -- "${release_temp}"
    release_temp=
  else
    /bin/mv -- "${release_temp}" "${candidate_release}"
    release_temp=
  fi
fi

candidate_script="${candidate_release}/scripts/deploy-guess-pokemon.sh"
if [[ ! -x "${candidate_script}" || -L "${candidate_script}" ]]; then
  fail "verified candidate deploy script is missing or unsafe"
fi

token_file="$(
  /usr/bin/mktemp "${TMPDIR:-/tmp}/guess-pokemon-token.XXXXXX"
)"
/bin/chmod 600 "${token_file}"
printf '%s' "${registry_token}" >"${token_file}"
registry_token=
exec 3<"${token_file}"
/bin/rm -f -- "${token_file}"
token_file=

cleanup
trap - EXIT INT TERM

if [[ "${config_mode}" == update ]]; then
  exec "${candidate_script}" \
    "${commit_sha}" \
    update \
    "${config_digest}" \
    "${registry_user}" \
    <&3 3<&-
fi
exec "${candidate_script}" \
  "${commit_sha}" \
  keep \
  "${registry_user}" \
  <&3 3<&-
