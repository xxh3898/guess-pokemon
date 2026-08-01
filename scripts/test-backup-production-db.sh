#!/bin/bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd -P
)"
readonly SOURCE_SCRIPT="${SCRIPT_DIR}/backup-production-db.sh"
readonly PRODUCTION_BACKUP_DIR=/Users/homeserver/Server/backups/guess-pokemon/data
readonly PRODUCTION_OFFSITE_ROOT=/Users/homeserver/Server/backups/guess-pokemon/offsite
readonly PRODUCTION_ICLOUD_ROOT='/Users/homeserver/Library/Mobile Documents/com~apple~CloudDocs/HomeServerBackups/guess-pokemon'
readonly ZERO_DIGEST=sha256:0000000000000000000000000000000000000000000000000000000000000000
readonly APPLICATION_SHA=1111111111111111111111111111111111111111
readonly PREVIOUS_SHA=2222222222222222222222222222222222222222
readonly CONFIG_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
readonly CONFIG_SHA=3333333333333333333333333333333333333333

test_root="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/guess-backup-test.XXXXXX")"

cleanup() {
  if [[ "$(basename "${test_root}")" == guess-backup-test.* ]]; then
    /bin/rm -rf -- "${test_root}"
  fi
}

trap cleanup EXIT INT TERM

mock_docker="${test_root}/docker"
mock_age="${test_root}/age"
mock_curl="${test_root}/curl"
docker_log="${test_root}/docker.log"
heartbeat_log="${test_root}/heartbeat.log"

{
  printf '%s\n' \
    '#!/bin/bash' \
    'set -Eeuo pipefail' \
    'printf "%s\n" "$*" >>"${DOCKER_LOG}"' \
    'if [[ " $* " != *" --project-name guess-pokemon "* ]]; then' \
    '  printf "Compose project name was not pinned: %s\n" "$*" >&2' \
    '  exit 1' \
    'elif [[ " $* " == *" ps --status running --services "* ]]; then' \
    '  printf "db\n"' \
    'elif [[ " $* " == *" pg_restore --list "* ]]; then' \
    '  /bin/cat >/dev/null' \
    '  printf "%s\n" "1; 0 0 TABLE DATA public app_user owner" "2; 0 0 TABLE DATA public pokemon_species owner"' \
    'elif [[ " $* " == *" pg_restore --data-only "* ]]; then' \
    '  /bin/cat >/dev/null' \
    '  if [[ -n "${MOCK_PG_RESTORE_DATA_FILE:-}" ]]; then' \
    '    /bin/cat "${MOCK_PG_RESTORE_DATA_FILE}"' \
    '  else' \
    '    printf "%s\n" "COPY public.app_user (id) FROM stdin;" "1" "2" "\\." "COPY public.pokemon_species (id) FROM stdin;" "1" "2" "3" "\\."' \
    '  fi' \
    'elif [[ "$*" == *"BACKUP_QUERY=dump"* ]]; then' \
    '  printf "mock PostgreSQL custom archive\n"' \
    'elif [[ "$*" == *"BACKUP_QUERY=version"* ]]; then' \
    '  printf "18.4\n"' \
    'elif [[ "$*" == *"BACKUP_QUERY=record-counts"* ]]; then' \
    '  printf "app_user\t31\npokemon_species\t1025\n"' \
    'else' \
    '  printf "unexpected Docker invocation: %s\n" "$*" >&2' \
    '  exit 1' \
    'fi'
} >"${mock_docker}"
/bin/chmod 700 "${mock_docker}"

{
  printf '%s\n' \
    '#!/bin/bash' \
    'set -Eeuo pipefail' \
    'printf "age-encryption.org/v1\n"' \
    '/bin/cat'
} >"${mock_age}"
/bin/chmod 700 "${mock_age}"

{
  printf '%s\n' \
    '#!/bin/bash' \
    'set -Eeuo pipefail' \
    'printf "%s\n" "$*" >>"${HEARTBEAT_LOG}"'
} >"${mock_curl}"
/bin/chmod 700 "${mock_curl}"
: >"${heartbeat_log}"

prepare_script() {
  local app_dir="$1"
  local backup_dir="$2"
  local target_script="$3"

  if ! /usr/bin/grep -Fqx \
    "readonly BACKUP_DIR=${PRODUCTION_BACKUP_DIR}" \
    "${SOURCE_SCRIPT}"
  then
    printf 'Production backup path contract is missing: %s\n' \
      "${PRODUCTION_BACKUP_DIR}" \
      >&2
    exit 1
  fi

  /usr/bin/sed \
    -e "s#readonly DOCKER_BIN=/usr/local/bin/docker#readonly DOCKER_BIN=${mock_docker}#" \
    -e "s#readonly AGE_BIN=/opt/homebrew/bin/age#readonly AGE_BIN=${mock_age}#" \
    -e "s#readonly CURL_BIN=/usr/bin/curl#readonly CURL_BIN=${mock_curl}#" \
    -e "s#readonly APP_DIR=/Users/homeserver/Server/apps/guess-pokemon#readonly APP_DIR=${app_dir}#" \
    -e "s#readonly BACKUP_DIR=${PRODUCTION_BACKUP_DIR}#readonly BACKUP_DIR=${backup_dir}#" \
    -e "s#readonly OFFSITE_STAGING_ROOT=${PRODUCTION_OFFSITE_ROOT}#readonly OFFSITE_STAGING_ROOT=${backup_dir}-offsite#" \
    -e "s#readonly ICLOUD_ROOT='${PRODUCTION_ICLOUD_ROOT}'#readonly ICLOUD_ROOT='${backup_dir}-icloud'#" \
    "${SOURCE_SCRIPT}" >"${target_script}"
  if ! /usr/bin/grep -Fqx "readonly BACKUP_DIR=${backup_dir}" "${target_script}"; then
    printf 'Test backup path substitution failed: %s\n' "${backup_dir}" >&2
    exit 1
  fi
  /bin/chmod 700 "${target_script}"
}

prepare_app() {
  local app_dir="$1"

  /bin/mkdir -p "${app_dir}"
  printf 'POSTGRES_DB=guess\nPOSTGRES_USER=guess\nPOSTGRES_PASSWORD=test\n' \
    >"${app_dir}/.env"
  printf 'age1testrecipient000000000000000000000000000000000000000000000\n' \
    >"${app_dir}/backup-age-recipient-v1.txt"
  /bin/chmod 600 "${app_dir}/backup-age-recipient-v1.txt"
}

seed_retention_matrix() {
  local backup_dir="$1"
  local expected_file="$2"

  /usr/bin/python3 - "${backup_dir}" "${expected_file}" <<'PY'
import datetime as dt
import hashlib
import json
import os
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
expected_path = pathlib.Path(sys.argv[2])
root.mkdir(parents=True, exist_ok=True)
kst = dt.timezone(dt.timedelta(hours=9))
now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
prefix = "guess-pokemon-production-"

def name_for(timestamp):
    return prefix + timestamp.astimezone(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")

def write_valid(timestamp):
    name = name_for(timestamp)
    snapshot = root / name
    (snapshot / "database").mkdir(parents=True)
    (snapshot / "files").mkdir(parents=True)
    dump = b"retention fixture\n"
    (snapshot / "database" / "dump").write_bytes(dump)
    (snapshot / "files" / "sha256.txt").write_text("", encoding="utf-8")
    manifest = {
        "schemaVersion": 1,
        "status": "success",
        "project": "guess-pokemon",
        "environment": "production",
        "database": {
            "engine": "postgresql",
            "version": "18.4",
            "dumpFile": "database/dump",
            "bytes": len(dump),
            "sha256": hashlib.sha256(dump).hexdigest(),
            "validator": "pg_restore --list",
            "recordCounts": {"app_user": 0, "pokemon_species": 0},
            "recordCountsSource": "database/dump",
        },
        "files": {
            "enabled": False,
            "directory": None,
            "manifest": "files/sha256.txt",
            "count": 0,
            "bytes": 0,
        },
    }
    (snapshot / "manifest.json").write_text(
        json.dumps(manifest) + "\n", encoding="utf-8"
    )
    (snapshot / "SUCCESS").write_text("snapshot complete\n", encoding="utf-8")
    return name

recent_seed = [write_valid(now - dt.timedelta(seconds=offset)) for offset in (1, 2, 3)]
daily_keep = []
prune_expected = []
today = now.astimezone(kst).date()
for offset in range(1, 9):
    target = today - dt.timedelta(days=offset)
    before = dt.datetime.combine(target, dt.time(5, 55), tzinfo=kst)
    first = dt.datetime.combine(target, dt.time(6, 5), tzinfo=kst)
    later = dt.datetime.combine(target, dt.time(12, 5), tzinfo=kst)
    before_name = write_valid(before)
    first_name = write_valid(first)
    later_name = write_valid(later)
    if offset <= 7:
        daily_keep.append(first_name)
        prune_expected.extend([before_name, later_name])
    else:
        prune_expected.extend([before_name, first_name, later_name])

invalid_time = dt.datetime.combine(
    today - dt.timedelta(days=9), dt.time(6, 5), tzinfo=kst
)
invalid_name = name_for(invalid_time)
(root / invalid_name).mkdir()
(root / invalid_name / "manifest.json").write_text("{}\n", encoding="utf-8")

symlink_time = dt.datetime.combine(
    today - dt.timedelta(days=10), dt.time(6, 5), tzinfo=kst
)
symlink_name = name_for(symlink_time)
os.symlink(recent_seed[0], root / symlink_name)

drift_source_time = dt.datetime.combine(
    today - dt.timedelta(days=11), dt.time(6, 5), tzinfo=kst
)
drift_source_name = write_valid(drift_source_time)
drift_source_manifest_path = root / drift_source_name / "manifest.json"
drift_source_manifest = json.loads(
    drift_source_manifest_path.read_text(encoding="utf-8")
)
drift_source_manifest["database"]["recordCountsSource"] = "live-post-dump"
drift_source_manifest_path.write_text(
    json.dumps(drift_source_manifest) + "\n", encoding="utf-8"
)

expected_path.write_text(
    json.dumps(
        {
            "recentSeed": recent_seed,
            "dailyKeep": daily_keep,
            "pruneExpected": prune_expected,
            "invalidName": invalid_name,
            "driftSourceName": drift_source_name,
            "symlinkName": symlink_name,
        }
    )
    + "\n",
    encoding="utf-8",
)
PY
}

assert_retention_matrix() {
  local backup_dir="$1"
  local expected_file="$2"

  /usr/bin/python3 - \
    "${backup_dir}" \
    "${backup_dir}/retention-plan.json" \
    "${expected_file}" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
plan = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
expected = json.loads(pathlib.Path(sys.argv[3]).read_text(encoding="utf-8"))
keep = set(plan["keep"])
prune = set(plan["pruneCandidates"])
invalid = set(plan["invalidIgnored"])

assert set(expected["recentSeed"]) <= keep
assert set(expected["dailyKeep"]) <= keep
assert set(expected["pruneExpected"]) <= prune
assert expected["invalidName"] in invalid
assert expected["driftSourceName"] in invalid
assert expected["symlinkName"] not in keep | prune | invalid
assert keep.isdisjoint(prune)
assert len(keep) == 11
for name in expected["pruneExpected"]:
    assert (root / name).is_dir(), "dry-run retention must not delete candidates"
assert (root / expected["symlinkName"]).is_symlink()
PY
}

assert_snapshot_contract() {
  local backup_dir="$1"
  local expected_trigger="$2"
  local snapshot

  snapshot="$(
    /usr/bin/find "${backup_dir}" \
      -mindepth 1 \
      -maxdepth 2 \
      -type f \
      -name manifest.json \
      -exec /usr/bin/grep -l \
        "\"trigger\": \"${expected_trigger}\"" {} +
  )"
  test "$(printf '%s\n' "${snapshot}" | /usr/bin/grep -c .)" = 1
  snapshot="${snapshot%/manifest.json}"
  test -n "${snapshot}"
  test -f "${snapshot}/SUCCESS"
  test -f "${snapshot}/manifest.json"
  test -f "${snapshot}/database/dump"
  test -f "${snapshot}/database/record-counts.tsv"
  test -f "${snapshot}/files/sha256.txt"
  test -f "${backup_dir}/retention-plan.json"
  /usr/bin/python3 - \
    "${snapshot}" \
    "${backup_dir}/retention-plan.json" \
    "${expected_trigger}" \
    "${APPLICATION_SHA}" \
    "${CONFIG_DIGEST}" <<'PY'
import hashlib
import json
import pathlib
import sys

snapshot = pathlib.Path(sys.argv[1])
plan_path = pathlib.Path(sys.argv[2])
trigger, application_sha, config_digest = sys.argv[3:]
manifest = json.loads((snapshot / "manifest.json").read_text(encoding="utf-8"))
dump = snapshot / manifest["database"]["dumpFile"]
assert manifest["schemaVersion"] == 1
assert manifest["status"] == "success"
assert manifest["project"] == "guess-pokemon"
assert manifest["environment"] == "production"
assert manifest["trigger"] == trigger
assert manifest["source"]["applicationSha"] == application_sha
assert manifest["source"]["runtimeConfigDigest"] == config_digest
assert manifest["database"]["engine"] == "postgresql"
assert manifest["database"]["version"] == "18.4"
assert manifest["database"]["recordCounts"] == {
    "app_user": 2,
    "pokemon_species": 3,
}
assert manifest["database"]["recordCountsSource"] == "database/dump"
assert manifest["database"]["bytes"] == dump.stat().st_size
assert manifest["database"]["sha256"] == hashlib.sha256(dump.read_bytes()).hexdigest()
assert manifest["files"] == {
    "bytes": 0,
    "count": 0,
    "directory": None,
    "enabled": False,
    "manifest": "files/sha256.txt",
}
assert (snapshot / "files" / "sha256.txt").stat().st_size == 0
plan = json.loads(plan_path.read_text(encoding="utf-8"))
assert plan["mode"] == "dry-run"
assert plan["policy"] == {
    "dailyAtOrAfterKst": "06:00",
    "dailyDays": 7,
    "recent": 4,
}
assert snapshot.name in plan["keep"]
assert isinstance(plan["pruneCandidates"], list)
PY
  test "$(
    /usr/bin/find "${backup_dir}-icloud" \
      -mindepth 1 \
      -maxdepth 1 \
      -type f \
      -name 'guess-pokemon-production-*.tar.age' \
      | /usr/bin/wc -l \
      | /usr/bin/tr -d ' '
  )" = 1
  test "$(
    /usr/bin/find "${backup_dir}-offsite" \
      -mindepth 1 \
      -maxdepth 1 \
      -print \
      | /usr/bin/wc -l \
      | /usr/bin/tr -d ' '
  )" = 0
}

runtime_content_sha256() {
  local release_dir="$1"

  {
    /usr/bin/shasum -a 256 "${release_dir}/compose.yaml"
    /usr/bin/shasum -a 256 \
      "${release_dir}/infra/nginx/cloudflare-edge-real-ip.conf"
    if [[ -f "${release_dir}/scripts/backup-guess-pokemon.sh" ]]; then
      /usr/bin/shasum -a 256 \
        "${release_dir}/scripts/backup-guess-pokemon.sh"
      /usr/bin/shasum -a 256 \
        "${release_dir}/scripts/deploy-guess-pokemon.sh"
    fi
  } | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}'
}

prepare_runtime_state() {
  local app_dir="$1"
  local release_shape="${2:-synced}"
  local release_dir="${app_dir}/runtime-config/releases/${CONFIG_DIGEST#sha256:}"
  local content_sha

  /bin/mkdir -p "${release_dir}/infra/nginx"
  printf 'name: guess-pokemon\nservices: {}\n' >"${release_dir}/compose.yaml"
  printf 'set_real_ip_from 192.0.2.0/24;\n' \
    >"${release_dir}/infra/nginx/cloudflare-edge-real-ip.conf"
  if [[ "${release_shape}" == synced ]]; then
    /bin/mkdir -p "${release_dir}/scripts"
    printf '#!/bin/bash\nexit 0\n' \
      >"${release_dir}/scripts/backup-guess-pokemon.sh"
    printf '#!/bin/bash\nexit 0\n' \
      >"${release_dir}/scripts/deploy-guess-pokemon.sh"
    /bin/chmod 700 \
      "${release_dir}/scripts/backup-guess-pokemon.sh" \
      "${release_dir}/scripts/deploy-guess-pokemon.sh"
  elif [[ "${release_shape}" != legacy ]]; then
    printf 'Unsupported test release shape: %s\n' "${release_shape}" >&2
    exit 1
  fi
  content_sha="$(runtime_content_sha256 "${release_dir}")"

  {
    printf 'APPLICATION_REVISION=%s\n' "${APPLICATION_SHA}"
    printf 'PREVIOUS_APPLICATION_REVISION=%s\n' "${PREVIOUS_SHA}"
    printf 'PREVIOUS_RUNTIME_CONFIG_DIGEST=%s\n' "${ZERO_DIGEST}"
    printf 'RUNTIME_CONFIG_CONTENT_SHA256=%s\n' "${content_sha}"
    printf 'RUNTIME_CONFIG_DIGEST=%s\n' "${CONFIG_DIGEST}"
    printf 'RUNTIME_CONFIG_REVISION=%s\n' "${CONFIG_SHA}"
  } >"${app_dir}/runtime-config/state"
  printf 'RUNTIME_CONFIG_V2=initialized\n' \
    >"${app_dir}/.runtime-config-v2-initialized"
  /bin/chmod 400 "${app_dir}/.runtime-config-v2-initialized"
  /bin/ln -s \
    "releases/${CONFIG_DIGEST#sha256:}" \
    "${app_dir}/runtime-config/current"
}

v2_app="${test_root}/v2-app"
v2_backups="${test_root}/v2-backups"
v2_script="${test_root}/v2-backup.sh"
v2_retention_expected="${test_root}/v2-retention-expected.json"
/bin/mkdir -p "${v2_app}" "${v2_backups}"
prepare_app "${v2_app}"
printf '%s\n' \
  'LOCAL_HEARTBEAT_URL=https://heartbeat.invalid/api/push/guess-local-test' \
  'ICLOUD_STAGE_HEARTBEAT_URL=https://heartbeat.invalid/api/push/guess-icloud-test' \
  >"${v2_app}/backup-heartbeats.conf"
/bin/chmod 600 "${v2_app}/backup-heartbeats.conf"
seed_retention_matrix "${v2_backups}" "${v2_retention_expected}"
prepare_runtime_state "${v2_app}"
prepare_script "${v2_app}" "${v2_backups}" "${v2_script}"

COMPOSE_PROJECT_NAME=ambient-project \
DOCKER_LOG="${docker_log}" \
HEARTBEAT_LOG="${heartbeat_log}" \
  "${v2_script}" >/dev/null
expected_release="${v2_app}/runtime-config/releases/${CONFIG_DIGEST#sha256:}"
/usr/bin/grep -Fq -- "--project-name guess-pokemon" "${docker_log}"
/usr/bin/grep -Fq -- "--project-directory ${expected_release}" "${docker_log}"
/usr/bin/grep -Fq -- "--file ${expected_release}/compose.yaml" "${docker_log}"
if /usr/bin/grep -q 'BACKUP_QUERY=record-counts' "${docker_log}"; then
  printf 'Snapshot row counts must not be queried from the live database after dump\n' >&2
  exit 1
fi
test "$(find "${v2_backups}" -name 'guess-pokemon-production-*' -type d | wc -l | tr -d ' ')" -ge 1
assert_snapshot_contract "${v2_backups}" scheduled
assert_retention_matrix "${v2_backups}" "${v2_retention_expected}"
test "$(/usr/bin/wc -l <"${heartbeat_log}" | /usr/bin/tr -d ' ')" = 2
/usr/bin/grep -Fq '/api/push/guess-local-test' "${heartbeat_log}"
/usr/bin/grep -Fq '/api/push/guess-icloud-test' "${heartbeat_log}"

malformed_archive_app="${test_root}/malformed-archive-app"
malformed_archive_backups="${test_root}/malformed-archive-backups"
malformed_archive_script="${test_root}/malformed-archive-backup.sh"
malformed_archive_data="${test_root}/malformed-archive-data.sql"
printf '%s\n' \
  'COPY public.app_user (id) FROM stdin;' \
  '1' \
  >"${malformed_archive_data}"
/bin/mkdir -p "${malformed_archive_app}" "${malformed_archive_backups}"
prepare_app "${malformed_archive_app}"
prepare_runtime_state "${malformed_archive_app}"
prepare_script \
  "${malformed_archive_app}" \
  "${malformed_archive_backups}" \
  "${malformed_archive_script}"

if MOCK_PG_RESTORE_DATA_FILE="${malformed_archive_data}" \
  DOCKER_LOG="${docker_log}" \
  "${malformed_archive_script}" >/dev/null 2>&1
then
  printf 'backup accepted a malformed archive data stream\n' >&2
  exit 1
fi
test "$(find "${malformed_archive_backups}" -name 'guess-pokemon-production-*' -type d | wc -l | tr -d ' ')" = 0

legacy_v2_app="${test_root}/legacy-v2-app"
legacy_v2_backups="${test_root}/legacy-v2-backups"
legacy_v2_script="${test_root}/legacy-v2-backup.sh"
/bin/mkdir -p "${legacy_v2_app}" "${legacy_v2_backups}"
prepare_app "${legacy_v2_app}"
prepare_runtime_state "${legacy_v2_app}" legacy
prepare_script "${legacy_v2_app}" "${legacy_v2_backups}" "${legacy_v2_script}"

: >"${docker_log}"
DOCKER_LOG="${docker_log}" "${legacy_v2_script}" --trigger predeploy >/dev/null
legacy_v2_release="${legacy_v2_app}/runtime-config/releases/${CONFIG_DIGEST#sha256:}"
/usr/bin/grep -Fq -- "--project-directory ${legacy_v2_release}" "${docker_log}"
/usr/bin/grep -Fq -- "--file ${legacy_v2_release}/compose.yaml" "${docker_log}"
test "$(find "${legacy_v2_backups}" -name 'guess-pokemon-production-*' -type d | wc -l | tr -d ' ')" = 1
assert_snapshot_contract "${legacy_v2_backups}" predeploy

unsafe_app="${test_root}/unsafe-app"
unsafe_backups="${test_root}/unsafe-backups"
unsafe_script="${test_root}/unsafe-backup.sh"
/bin/mkdir -p "${unsafe_app}" "${unsafe_backups}"
prepare_app "${unsafe_app}"
prepare_runtime_state "${unsafe_app}"
/bin/rm -f -- "${unsafe_app}/runtime-config/current"
/bin/ln -s releases/not-the-verified-release "${unsafe_app}/runtime-config/current"
prepare_script "${unsafe_app}" "${unsafe_backups}" "${unsafe_script}"

if DOCKER_LOG="${docker_log}" "${unsafe_script}" >/dev/null 2>&1; then
  printf 'backup unexpectedly accepted a current pointer that disagrees with state\n' >&2
  exit 1
fi
test "$(find "${unsafe_backups}" -name 'guess-pokemon-production-*' -type d | wc -l | tr -d ' ')" = 0

tampered_app="${test_root}/tampered-app"
tampered_backups="${test_root}/tampered-backups"
tampered_script="${test_root}/tampered-backup.sh"
/bin/mkdir -p "${tampered_app}" "${tampered_backups}"
prepare_app "${tampered_app}"
prepare_runtime_state "${tampered_app}"
printf '\n# tampered after verification\n' \
  >>"${tampered_app}/runtime-config/releases/${CONFIG_DIGEST#sha256:}/compose.yaml"
prepare_script "${tampered_app}" "${tampered_backups}" "${tampered_script}"

if DOCKER_LOG="${docker_log}" "${tampered_script}" >/dev/null 2>&1; then
  printf 'backup unexpectedly accepted a tampered runtime release\n' >&2
  exit 1
fi
test "$(find "${tampered_backups}" -name 'guess-pokemon-production-*' -type d | wc -l | tr -d ' ')" = 0

symlink_state_app="${test_root}/symlink-state-app"
symlink_state_backups="${test_root}/symlink-state-backups"
symlink_state_script="${test_root}/symlink-state-backup.sh"
/bin/mkdir -p "${symlink_state_app}" "${symlink_state_backups}"
prepare_app "${symlink_state_app}"
prepare_runtime_state "${symlink_state_app}"
/bin/mv \
  "${symlink_state_app}/runtime-config/state" \
  "${symlink_state_app}/runtime-config/state.target"
/bin/ln -s state.target "${symlink_state_app}/runtime-config/state"
prepare_script \
  "${symlink_state_app}" \
  "${symlink_state_backups}" \
  "${symlink_state_script}"

if DOCKER_LOG="${docker_log}" "${symlink_state_script}" >/dev/null 2>&1; then
  printf 'backup unexpectedly accepted a symlink runtime state\n' >&2
  exit 1
fi
test "$(find "${symlink_state_backups}" -name 'guess-pokemon-production-*' -type d | wc -l | tr -d ' ')" = 0

invalid_heartbeat_app="${test_root}/invalid-heartbeat-app"
invalid_heartbeat_backups="${test_root}/invalid-heartbeat-backups"
invalid_heartbeat_script="${test_root}/invalid-heartbeat-backup.sh"
/bin/mkdir -p "${invalid_heartbeat_app}" "${invalid_heartbeat_backups}"
prepare_app "${invalid_heartbeat_app}"
prepare_runtime_state "${invalid_heartbeat_app}"
prepare_script \
  "${invalid_heartbeat_app}" \
  "${invalid_heartbeat_backups}" \
  "${invalid_heartbeat_script}"
printf '%s\n' \
  'LOCAL_HEARTBEAT_URL=https://heartbeat.invalid/api/push/local' \
  'ICLOUD_STAGE_HEARTBEAT_URL=https://heartbeat.invalid/api/push/icloud' \
  >"${invalid_heartbeat_app}/backup-heartbeats.conf"
/bin/chmod 644 "${invalid_heartbeat_app}/backup-heartbeats.conf"

if DOCKER_LOG="${docker_log}" \
  "${invalid_heartbeat_script}" >/dev/null 2>&1
then
  printf 'backup unexpectedly accepted an insecure heartbeat config mode\n' >&2
  exit 1
fi
test "$(find "${invalid_heartbeat_backups}" -name 'guess-pokemon-production-*' -type d | wc -l | tr -d ' ')" = 0

orphan_app="${test_root}/orphan-app"
orphan_backups="${test_root}/orphan-backups"
orphan_script="${test_root}/orphan-backup.sh"
/bin/mkdir -p \
  "${orphan_app}/runtime-config/releases/orphan-release" \
  "${orphan_backups}"
prepare_app "${orphan_app}"
printf 'name: guess-pokemon\nservices: {}\n' >"${orphan_app}/compose.yaml"
printf 'RUNTIME_CONFIG_V2=initialized\n' \
  >"${orphan_app}/.runtime-config-v2-initialized"
prepare_script "${orphan_app}" "${orphan_backups}" "${orphan_script}"

if DOCKER_LOG="${docker_log}" "${orphan_script}" >/dev/null 2>&1; then
  printf 'backup unexpectedly accepted orphan runtime releases without state\n' >&2
  exit 1
fi
test "$(find "${orphan_backups}" -name 'guess-pokemon-production-*' -type d | wc -l | tr -d ' ')" = 0

legacy_app="${test_root}/legacy-app"
legacy_backups="${test_root}/legacy-backups"
legacy_script="${test_root}/legacy-backup.sh"
/bin/mkdir -p \
  "${legacy_app}/runtime-config/releases/bootstrap-candidate" \
  "${legacy_backups}"
prepare_app "${legacy_app}"
printf 'name: guess-pokemon\nservices: {}\n' >"${legacy_app}/compose.yaml"
printf 'candidate release retained before first successful v2 state\n' \
  >"${legacy_app}/runtime-config/releases/bootstrap-candidate/candidate"
prepare_script "${legacy_app}" "${legacy_backups}" "${legacy_script}"

: >"${docker_log}"
DOCKER_LOG="${docker_log}" "${legacy_script}" >/dev/null
/usr/bin/grep -Fq -- "--project-name guess-pokemon" "${docker_log}"
/usr/bin/grep -Fq -- "--project-directory ${legacy_app}" "${docker_log}"
/usr/bin/grep -Fq -- "--file ${legacy_app}/compose.yaml" "${docker_log}"

printf 'Guess Pokémon production backup selection tests passed\n'
