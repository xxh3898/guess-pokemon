#!/bin/bash

set -Eeuo pipefail

readonly PROJECT_ROOT="$(
  CDPATH= cd -- "$(dirname -- "$0")/.." && pwd
)"
readonly DEPLOY_BOOTSTRAP_SOURCE="${PROJECT_ROOT}/scripts/deploy-guess-pokemon-ci.sh"
readonly BACKUP_BOOTSTRAP_SOURCE="${PROJECT_ROOT}/scripts/backup-production-db-bootstrap.sh"
readonly MOCK_DOCKER="${PROJECT_ROOT}/scripts/fixtures/mock-guess-pokemon-docker.sh"
readonly MOCK_LOCKF="${PROJECT_ROOT}/scripts/fixtures/mock-guess-pokemon-lockf.py"
readonly REVISION_ONE=1111111111111111111111111111111111111111
readonly REVISION_TWO=2222222222222222222222222222222222222222
readonly LEGACY_CONFIG_REVISION=3333333333333333333333333333333333333333
readonly LEGACY_CONFIG_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
readonly CONFIG_DIGEST=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
readonly INVALID_CONFIG_DIGEST=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
readonly ZERO_DIGEST=sha256:0000000000000000000000000000000000000000000000000000000000000000

test_root="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/guess-pokemon-script-bootstrap-test.XXXXXX")"

cleanup() {
  if [[ "$(/usr/bin/basename "${test_root}")" == guess-pokemon-script-bootstrap-test.* ]]; then
    /bin/rm -rf -- "${test_root}"
  fi
}

trap cleanup EXIT INT TERM

app_dir="${test_root}/app"
deploy_bootstrap="${test_root}/deploy-guess-pokemon-ci.sh"
backup_bootstrap="${test_root}/backup-production-db-bootstrap.sh"
legacy_deploy_script="${test_root}/legacy-deploy.sh"
legacy_backup_script="${test_root}/legacy-backup.sh"
runtime_compose="${test_root}/runtime-compose.yaml"
runtime_real_ip="${test_root}/cloudflare-edge-real-ip.conf"
runtime_deploy_script="${test_root}/runtime-deploy.sh"
runtime_backup_script="${test_root}/runtime-backup.sh"
candidate_log="${test_root}/candidate.log"
backup_marker="${test_root}/backup.marker"
legacy_backup_marker="${test_root}/legacy-backup.marker"
signal_ready="${test_root}/signal.ready"
signal_marker="${test_root}/signal.marker"
backup_lock_ready="${test_root}/backup-lock.ready"
backup_lock_signal_marker="${test_root}/backup-lock-signal.marker"
docker_log="${test_root}/docker.log"
operation_lock="${app_dir}/.guess-pokemon-operation.lock"

lockf_bin=/usr/bin/lockf
if [[ "${GUESS_POKEMON_TEST_FORCE_MOCK_LOCKF:-false}" == true ]] \
  || [[ ! -x "${lockf_bin}" ]]
then
  lockf_bin="${MOCK_LOCKF}"
fi

/bin/mkdir -p "${app_dir}/runtime-config/releases"
printf 'API_IMAGE=unchanged\nWEB_IMAGE=unchanged\n' >"${app_dir}/.env"
printf 'name: guess-pokemon\nservices: {}\n' >"${runtime_compose}"
printf 'set_real_ip_from 192.0.2.0/24;\n' >"${runtime_real_ip}"

printf '%s\n' \
  '#!/bin/bash' \
  'set -Eeuo pipefail' \
  'if [[ "${1:-}" == recover ]]; then' \
  '  printf "recover\n" >>"${FAKE_CANDIDATE_LOG}"' \
  '  exit "${FAKE_CANDIDATE_EXIT_CODE:-0}"' \
  'fi' \
  'if { : <&3; } 2>/dev/null; then' \
  '  exit 66' \
  'fi' \
  'token="$(/bin/cat)"' \
  'if [[ "${token}" != test-token ]]; then' \
  '  exit 65' \
  'fi' \
  'printf "%s\n" "$*" >>"${FAKE_CANDIDATE_LOG}"' \
  'if [[ "${FAKE_CANDIDATE_WAIT:-false}" == true ]]; then' \
  '  : >"${FAKE_SIGNAL_READY}"' \
  '  trap '\''printf "term\n" >"${FAKE_SIGNAL_MARKER}"; exit 143'\'' TERM' \
  '  while :; do /bin/sleep 1; done' \
  'fi' \
  'exit "${FAKE_CANDIDATE_EXIT_CODE:-0}"' \
  >"${runtime_deploy_script}"

printf '%s\n' \
  '#!/bin/bash' \
  'set -Eeuo pipefail' \
  'printf "candidate\n" >>"${FAKE_BACKUP_MARKER}"' \
  'if [[ "${FAKE_BACKUP_WAIT:-false}" == true ]]; then' \
  '  : >"${FAKE_BACKUP_LOCK_READY}"' \
  '  trap '\''printf "term\n" >"${FAKE_BACKUP_LOCK_SIGNAL_MARKER}"; exit 143'\'' TERM' \
  '  while :; do /bin/sleep 1; done' \
  'fi' \
  >"${runtime_backup_script}"

printf '%s\n' \
  '#!/bin/bash' \
  'exit 0' \
  >"${legacy_deploy_script}"
printf '%s\n' \
  '#!/bin/bash' \
  'printf "legacy\n" >>"${FAKE_LEGACY_BACKUP_MARKER}"' \
  >"${legacy_backup_script}"

/bin/chmod 700 \
  "${runtime_deploy_script}" \
  "${runtime_backup_script}" \
  "${legacy_deploy_script}" \
  "${legacy_backup_script}" \
  "${MOCK_DOCKER}" \
  "${MOCK_LOCKF}"

/usr/bin/sed \
  -e "s#readonly DOCKER_BIN=/usr/local/bin/docker#readonly DOCKER_BIN=${MOCK_DOCKER}#" \
  -e "s#readonly LOCKF_BIN=/usr/bin/lockf#readonly LOCKF_BIN=${lockf_bin}#" \
  -e "s#readonly APP_DIR=/Users/homeserver/Server/apps/guess-pokemon#readonly APP_DIR=${app_dir}#" \
  -e "s#readonly LEGACY_DEPLOY_SCRIPT=/Users/homeserver/Server/scripts/deploy/deploy-guess-pokemon.sh#readonly LEGACY_DEPLOY_SCRIPT=${legacy_deploy_script}#" \
  "${DEPLOY_BOOTSTRAP_SOURCE}" >"${deploy_bootstrap}"
/usr/bin/sed \
  -e "s#readonly LOCKF_BIN=/usr/bin/lockf#readonly LOCKF_BIN=${lockf_bin}#" \
  -e "s#readonly APP_DIR=/Users/homeserver/Server/apps/guess-pokemon#readonly APP_DIR=${app_dir}#" \
  -e "s#readonly LEGACY_BACKUP_SCRIPT=/Users/homeserver/Server/scripts/backup/backup-guess-pokemon.sh#readonly LEGACY_BACKUP_SCRIPT=${legacy_backup_script}#" \
  "${BACKUP_BOOTSTRAP_SOURCE}" >"${backup_bootstrap}"
/bin/chmod 700 "${deploy_bootstrap}" "${backup_bootstrap}"

runtime_content_sha256() {
  local release_dir="$1"
  {
    /usr/bin/shasum -a 256 "${release_dir}/compose.yaml"
    /usr/bin/shasum -a 256 \
      "${release_dir}/infra/nginx/cloudflare-edge-real-ip.conf"
    if [[ -f "${release_dir}/scripts/backup-guess-pokemon.sh" ]] \
      && [[ -f "${release_dir}/scripts/deploy-guess-pokemon.sh" ]]
    then
      /usr/bin/shasum -a 256 \
        "${release_dir}/scripts/backup-guess-pokemon.sh"
      /usr/bin/shasum -a 256 \
        "${release_dir}/scripts/deploy-guess-pokemon.sh"
    fi
  } | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}'
}

write_verified_state() {
  local config_digest="$1"
  local config_revision="$2"
  local release_dir="$3"
  local content_sha

  content_sha="$(runtime_content_sha256 "${release_dir}")"
  {
    printf 'APPLICATION_REVISION=%s\n' "${REVISION_ONE}"
    printf 'PREVIOUS_APPLICATION_REVISION=%s\n' "${REVISION_TWO}"
    printf 'PREVIOUS_RUNTIME_CONFIG_DIGEST=%s\n' "${ZERO_DIGEST}"
    printf 'RUNTIME_CONFIG_CONTENT_SHA256=%s\n' "${content_sha}"
    printf 'RUNTIME_CONFIG_DIGEST=%s\n' "${config_digest}"
    printf 'RUNTIME_CONFIG_REVISION=%s\n' "${config_revision}"
  } >"${app_dir}/runtime-config/state"
  /bin/chmod 600 "${app_dir}/runtime-config/state"
  if [[ ! -e "${app_dir}/.runtime-config-v2-initialized" ]]; then
    printf 'RUNTIME_CONFIG_V2=initialized\n' \
      >"${app_dir}/.runtime-config-v2-initialized"
    /bin/chmod 400 "${app_dir}/.runtime-config-v2-initialized"
  fi
  /bin/rm -f -- "${app_dir}/runtime-config/current"
  /bin/ln -s \
    "releases/${config_digest#sha256:}" \
    "${app_dir}/runtime-config/current"
}

legacy_release="${app_dir}/runtime-config/releases/${LEGACY_CONFIG_DIGEST#sha256:}"
/bin/mkdir -p "${legacy_release}/infra/nginx"
/bin/cp "${runtime_compose}" "${legacy_release}/compose.yaml"
/bin/cp \
  "${runtime_real_ip}" \
  "${legacy_release}/infra/nginx/cloudflare-edge-real-ip.conf"
write_verified_state \
  "${LEGACY_CONFIG_DIGEST}" \
  "${LEGACY_CONFIG_REVISION}" \
  "${legacy_release}"

/usr/bin/env \
  FAKE_BACKUP_MARKER="${backup_marker}" \
  FAKE_LEGACY_BACKUP_MARKER="${legacy_backup_marker}" \
  /bin/bash "${backup_bootstrap}"
/usr/bin/grep -Fxq legacy "${legacy_backup_marker}"
test ! -e "${backup_marker}"
legacy_backup_count="$(
  /usr/bin/wc -l <"${legacy_backup_marker}" | /usr/bin/tr -d ' '
)"

run_update() {
  printf 'test-token' \
    | /usr/bin/env \
        SSH_ORIGINAL_COMMAND="deploy-guess-pokemon-v2 ${REVISION_ONE} update ${CONFIG_DIGEST} test-user" \
        FAKE_RUNTIME_COMPOSE="${runtime_compose}" \
        FAKE_RUNTIME_REAL_IP="${runtime_real_ip}" \
        FAKE_RUNTIME_BACKUP_SCRIPT="${runtime_backup_script}" \
        FAKE_RUNTIME_DEPLOY_SCRIPT="${runtime_deploy_script}" \
        FAKE_CONFIG_REVISION="${FAKE_CONFIG_REVISION:-${REVISION_ONE}}" \
        FAKE_CONFIG_PROJECT="${FAKE_CONFIG_PROJECT:-guess-pokemon}" \
        FAKE_RUNTIME_EXTRA_DIR="${FAKE_RUNTIME_EXTRA_DIR:-false}" \
        FAKE_RUNTIME_EXTRA_FILE="${FAKE_RUNTIME_EXTRA_FILE:-false}" \
        FAKE_RUNTIME_INSECURE_SCRIPT_MODE="${FAKE_RUNTIME_INSECURE_SCRIPT_MODE:-false}" \
        FAKE_RUNTIME_INVALID_DEPLOY_SYNTAX="${FAKE_RUNTIME_INVALID_DEPLOY_SYNTAX:-false}" \
        FAKE_RUNTIME_SYMLINK="${FAKE_RUNTIME_SYMLINK:-false}" \
        FAKE_CANDIDATE_EXIT_CODE="${FAKE_CANDIDATE_EXIT_CODE:-0}" \
        FAKE_CANDIDATE_LOG="${candidate_log}" \
        FAKE_BACKUP_MARKER="${backup_marker}" \
        FAKE_SIGNAL_READY="${signal_ready}" \
        FAKE_SIGNAL_MARKER="${signal_marker}" \
        FAKE_DOCKER_LOG="${docker_log}" \
        /bin/bash "${deploy_bootstrap}"
}

state_sha_before="$(
  /usr/bin/shasum -a 256 "${app_dir}/runtime-config/state" \
    | /usr/bin/awk '{print $1}'
)"
env_sha_before="$(
  /usr/bin/shasum -a 256 "${app_dir}/.env" \
    | /usr/bin/awk '{print $1}'
)"
current_before="$(
  /usr/bin/readlink "${app_dir}/runtime-config/current"
)"

set +e
FAKE_CANDIDATE_EXIT_CODE=73 run_update >/dev/null 2>&1
candidate_failure_exit_code="$?"
set -e
if [[ "${candidate_failure_exit_code}" -ne 73 ]]; then
  printf 'Deploy bootstrap must preserve the candidate exit code\n' >&2
  exit 1
fi
candidate_release="${app_dir}/runtime-config/releases/${CONFIG_DIGEST#sha256:}"
test -d "${candidate_release}"
test "$(/usr/bin/readlink "${app_dir}/runtime-config/current")" = "${current_before}"
test "$(/usr/bin/shasum -a 256 "${app_dir}/runtime-config/state" | /usr/bin/awk '{print $1}')" \
  = "${state_sha_before}"
test "$(/usr/bin/shasum -a 256 "${app_dir}/.env" | /usr/bin/awk '{print $1}')" \
  = "${env_sha_before}"
test ! -e "${app_dir}/runtime-config/pending"

run_update
/usr/bin/grep -Fxq \
  "${REVISION_ONE} update ${CONFIG_DIGEST} test-user" \
  "${candidate_log}"

write_verified_state "${CONFIG_DIGEST}" "${REVISION_ONE}" "${candidate_release}"

printf 'test-token' \
  | /usr/bin/env \
      SSH_ORIGINAL_COMMAND="deploy-guess-pokemon-v2 ${REVISION_TWO} keep test-user" \
      FAKE_CANDIDATE_LOG="${candidate_log}" \
      FAKE_BACKUP_MARKER="${backup_marker}" \
      FAKE_SIGNAL_READY="${signal_ready}" \
      FAKE_SIGNAL_MARKER="${signal_marker}" \
      /bin/bash "${deploy_bootstrap}"
/usr/bin/grep -Fxq "${REVISION_TWO} keep test-user" "${candidate_log}"

/usr/bin/env \
  FAKE_CANDIDATE_LOG="${candidate_log}" \
  /bin/bash "${deploy_bootstrap}" recover
/usr/bin/grep -Fxq recover "${candidate_log}"

/usr/bin/env \
  FAKE_BACKUP_MARKER="${backup_marker}" \
  FAKE_LEGACY_BACKUP_MARKER="${legacy_backup_marker}" \
  /bin/bash "${backup_bootstrap}"
/usr/bin/grep -Fxq candidate "${backup_marker}"
test "$(
  /usr/bin/wc -l <"${legacy_backup_marker}" | /usr/bin/tr -d ' '
)" = "${legacy_backup_count}"

assert_preflight_failure() {
  local label="$1"
  local candidate_count_before
  local exit_code

  candidate_count_before="$(/usr/bin/wc -l <"${candidate_log}" | /usr/bin/tr -d ' ')"
  set +e
  printf 'test-token' \
    | /usr/bin/env \
        SSH_ORIGINAL_COMMAND="deploy-guess-pokemon-v2 ${REVISION_ONE} update ${INVALID_CONFIG_DIGEST} test-user" \
        FAKE_RUNTIME_COMPOSE="${runtime_compose}" \
        FAKE_RUNTIME_REAL_IP="${runtime_real_ip}" \
        FAKE_RUNTIME_BACKUP_SCRIPT="${runtime_backup_script}" \
        FAKE_RUNTIME_DEPLOY_SCRIPT="${runtime_deploy_script}" \
        FAKE_CONFIG_REVISION="${FAKE_CONFIG_REVISION:-${REVISION_ONE}}" \
        FAKE_CONFIG_PROJECT="${FAKE_CONFIG_PROJECT:-guess-pokemon}" \
        FAKE_RUNTIME_EXTRA_DIR="${FAKE_RUNTIME_EXTRA_DIR:-false}" \
        FAKE_RUNTIME_EXTRA_FILE="${FAKE_RUNTIME_EXTRA_FILE:-false}" \
        FAKE_RUNTIME_INSECURE_SCRIPT_MODE="${FAKE_RUNTIME_INSECURE_SCRIPT_MODE:-false}" \
        FAKE_RUNTIME_INVALID_DEPLOY_SYNTAX="${FAKE_RUNTIME_INVALID_DEPLOY_SYNTAX:-false}" \
        FAKE_RUNTIME_SYMLINK="${FAKE_RUNTIME_SYMLINK:-false}" \
        FAKE_CANDIDATE_LOG="${candidate_log}" \
        FAKE_DOCKER_LOG="${docker_log}" \
        /bin/bash "${deploy_bootstrap}" \
        >/dev/null 2>&1
  exit_code="$?"
  set -e
  if [[ "${exit_code}" -ne 1 ]]; then
    printf '%s must fail before candidate execution\n' "${label}" >&2
    exit 1
  fi
  test "$(/usr/bin/wc -l <"${candidate_log}" | /usr/bin/tr -d ' ')" \
    = "${candidate_count_before}"
  test "$(/usr/bin/readlink "${app_dir}/runtime-config/current")" \
    = "releases/${CONFIG_DIGEST#sha256:}"
  test ! -e "${app_dir}/runtime-config/pending"
}

FAKE_RUNTIME_INVALID_DEPLOY_SYNTAX=true \
  assert_preflight_failure "invalid candidate deploy syntax"
FAKE_RUNTIME_INSECURE_SCRIPT_MODE=true \
  assert_preflight_failure "insecure candidate script mode"
FAKE_RUNTIME_EXTRA_FILE=true \
  assert_preflight_failure "unexpected artifact file"
FAKE_RUNTIME_EXTRA_DIR=true \
  assert_preflight_failure "unexpected artifact directory"
FAKE_RUNTIME_SYMLINK=true \
  assert_preflight_failure "artifact symlink"
FAKE_CONFIG_PROJECT=other-project \
  assert_preflight_failure "runtime artifact project mismatch"
FAKE_CONFIG_REVISION="${REVISION_TWO}" \
  assert_preflight_failure "runtime artifact revision mismatch"

set +e
SSH_ORIGINAL_COMMAND="deploy-guess-pokemon-v2 ${REVISION_ONE} keep test-user; touch ${test_root}/injected" \
  /bin/bash "${deploy_bootstrap}" >/dev/null 2>&1
injection_exit_code="$?"
/bin/bash "${deploy_bootstrap}" recover extra >/dev/null 2>&1
extra_argument_exit_code="$?"
set -e
if [[ "${injection_exit_code}" -ne 64 || "${extra_argument_exit_code}" -ne 64 ]]; then
  printf 'Deploy bootstrap must reject command injection and extra arguments\n' >&2
  exit 1
fi
test ! -e "${test_root}/injected"

state_sha_before_signal="$(
  /usr/bin/shasum -a 256 "${app_dir}/runtime-config/state" \
    | /usr/bin/awk '{print $1}'
)"
env_sha_before_signal="$(
  /usr/bin/shasum -a 256 "${app_dir}/.env" \
    | /usr/bin/awk '{print $1}'
)"
set +e
printf 'test-token' \
  | /usr/bin/env \
      SSH_ORIGINAL_COMMAND="deploy-guess-pokemon-v2 ${REVISION_TWO} keep test-user" \
      FAKE_CANDIDATE_WAIT=true \
      FAKE_CANDIDATE_LOG="${candidate_log}" \
      FAKE_BACKUP_MARKER="${backup_marker}" \
      FAKE_SIGNAL_READY="${signal_ready}" \
      FAKE_SIGNAL_MARKER="${signal_marker}" \
      /bin/bash "${deploy_bootstrap}" &
signal_pid="$!"
set -e

ready_attempt=0
while [[ ! -f "${signal_ready}" && "${ready_attempt}" -lt 50 ]]; do
  /bin/sleep 0.1
  ready_attempt=$((ready_attempt + 1))
done
if [[ ! -f "${signal_ready}" ]]; then
  printf 'Candidate did not become ready for the signal test\n' >&2
  exit 1
fi

backup_count_before_contention="$(
  /usr/bin/wc -l <"${backup_marker}" | /usr/bin/tr -d ' '
)"
set +e
/usr/bin/env \
  FAKE_BACKUP_MARKER="${backup_marker}" \
  FAKE_LEGACY_BACKUP_MARKER="${legacy_backup_marker}" \
  /bin/bash "${backup_bootstrap}" >/dev/null 2>&1
backup_contention_exit_code="$?"
set -e
if [[ "${backup_contention_exit_code}" -ne 75 ]]; then
  printf 'Scheduled backup must fail while deploy holds the common lock\n' >&2
  exit 1
fi
test "$(
  /usr/bin/wc -l <"${backup_marker}" | /usr/bin/tr -d ' '
)" = "${backup_count_before_contention}"

/bin/kill -TERM "${signal_pid}"
set +e
wait "${signal_pid}"
signal_exit_code="$?"
set -e
if [[ "${signal_exit_code}" -ne 143 ]]; then
  printf 'Deploy bootstrap must transfer TERM handling to the candidate\n' >&2
  exit 1
fi
/usr/bin/grep -Fxq term "${signal_marker}"
test "$(/usr/bin/shasum -a 256 "${app_dir}/runtime-config/state" | /usr/bin/awk '{print $1}')" \
  = "${state_sha_before_signal}"
test "$(/usr/bin/shasum -a 256 "${app_dir}/.env" | /usr/bin/awk '{print $1}')" \
  = "${env_sha_before_signal}"
test "$(/usr/bin/readlink "${app_dir}/runtime-config/current")" \
  = "releases/${CONFIG_DIGEST#sha256:}"

/usr/bin/env \
  FAKE_BACKUP_MARKER="${backup_marker}" \
  FAKE_LEGACY_BACKUP_MARKER="${legacy_backup_marker}" \
  FAKE_BACKUP_WAIT=true \
  FAKE_BACKUP_LOCK_READY="${backup_lock_ready}" \
  FAKE_BACKUP_LOCK_SIGNAL_MARKER="${backup_lock_signal_marker}" \
  /bin/bash "${backup_bootstrap}" &
backup_lock_pid="$!"

ready_attempt=0
while [[ ! -f "${backup_lock_ready}" && "${ready_attempt}" -lt 50 ]]; do
  /bin/sleep 0.1
  ready_attempt=$((ready_attempt + 1))
done
if [[ ! -f "${backup_lock_ready}" ]]; then
  printf 'Backup did not become ready for the common lock test\n' >&2
  exit 1
fi

candidate_count_before_contention="$(
  /usr/bin/wc -l <"${candidate_log}" | /usr/bin/tr -d ' '
)"
docker_count_before_contention="$(
  /usr/bin/wc -l <"${docker_log}" | /usr/bin/tr -d ' '
)"
set +e
printf 'test-token' \
  | /usr/bin/env \
      SSH_ORIGINAL_COMMAND="deploy-guess-pokemon-v2 ${REVISION_TWO} keep test-user" \
      FAKE_CANDIDATE_LOG="${candidate_log}" \
      FAKE_BACKUP_MARKER="${backup_marker}" \
      FAKE_SIGNAL_READY="${signal_ready}" \
      FAKE_SIGNAL_MARKER="${signal_marker}" \
      /bin/bash "${deploy_bootstrap}" \
      >/dev/null 2>&1
deploy_contention_exit_code="$?"
set -e
if [[ "${deploy_contention_exit_code}" -ne 75 ]]; then
  printf 'Deploy must fail while scheduled backup holds the common lock\n' >&2
  exit 1
fi
test "$(
  /usr/bin/wc -l <"${candidate_log}" | /usr/bin/tr -d ' '
)" = "${candidate_count_before_contention}"
test "$(
  /usr/bin/wc -l <"${docker_log}" | /usr/bin/tr -d ' '
)" = "${docker_count_before_contention}"
test "$(/usr/bin/shasum -a 256 "${app_dir}/runtime-config/state" | /usr/bin/awk '{print $1}')" \
  = "${state_sha_before_signal}"
test "$(/usr/bin/shasum -a 256 "${app_dir}/.env" | /usr/bin/awk '{print $1}')" \
  = "${env_sha_before_signal}"
test "$(/usr/bin/readlink "${app_dir}/runtime-config/current")" \
  = "releases/${CONFIG_DIGEST#sha256:}"

/bin/kill -TERM "${backup_lock_pid}"
set +e
wait "${backup_lock_pid}"
backup_lock_signal_exit_code="$?"
set -e
if [[ "${backup_lock_signal_exit_code}" -ne 143 ]]; then
  printf 'Backup bootstrap must transfer TERM handling to the worker\n' >&2
  exit 1
fi
/usr/bin/grep -Fxq term "${backup_lock_signal_marker}"

/usr/bin/python3 -c '
import os
import stat
import sys

raise SystemExit(
    0 if stat.S_IMODE(os.stat(sys.argv[1]).st_mode) == 0o600 else 1
)
' "${operation_lock}"

backup_count_before_pending="$(
  /usr/bin/wc -l <"${backup_marker}" | /usr/bin/tr -d ' '
)"
printf 'TARGET_APPLICATION_REVISION=%s\n' "${REVISION_TWO}" \
  >"${app_dir}/runtime-config/pending"
set +e
/usr/bin/env \
  FAKE_BACKUP_MARKER="${backup_marker}" \
  FAKE_LEGACY_BACKUP_MARKER="${legacy_backup_marker}" \
  /bin/bash "${backup_bootstrap}" >/dev/null 2>&1
pending_backup_exit_code="$?"
set -e
if [[ "${pending_backup_exit_code}" -ne 1 ]]; then
  printf 'Scheduled backup must fail while runtime recovery is pending\n' >&2
  exit 1
fi
test "$(
  /usr/bin/wc -l <"${backup_marker}" | /usr/bin/tr -d ' '
)" = "${backup_count_before_pending}"
/bin/unlink "${app_dir}/runtime-config/pending"

/bin/unlink "${operation_lock}"
/bin/ln -s "${app_dir}/runtime-config/state" "${operation_lock}"
set +e
/usr/bin/env \
  FAKE_BACKUP_MARKER="${backup_marker}" \
  FAKE_LEGACY_BACKUP_MARKER="${legacy_backup_marker}" \
  /bin/bash "${backup_bootstrap}" >/dev/null 2>&1
unsafe_lock_exit_code="$?"
set -e
if [[ "${unsafe_lock_exit_code}" -ne 1 ]]; then
  printf 'Unsafe common lock path must fail closed\n' >&2
  exit 1
fi

printf 'Guess Pokémon runtime script bootstrap tests passed\n'
