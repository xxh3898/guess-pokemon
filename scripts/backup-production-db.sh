#!/bin/bash

set -Eeuo pipefail

umask 077

readonly DOCKER_BIN=/usr/local/bin/docker
readonly PYTHON_BIN=/usr/bin/python3
readonly AGE_BIN=/opt/homebrew/bin/age
readonly CURL_BIN=/usr/bin/curl
readonly APP_DIR=/Users/homeserver/Server/apps/guess-pokemon
readonly PROJECT_NAME=guess-pokemon
readonly LEGACY_COMPOSE_FILE="${APP_DIR}/compose.yaml"
readonly ENV_FILE="${APP_DIR}/.env"
readonly BACKUP_DIR=/Users/homeserver/Server/backups/guess-pokemon/data
readonly OFFSITE_STAGING_ROOT=/Users/homeserver/Server/backups/guess-pokemon/offsite
readonly ICLOUD_ROOT='/Users/homeserver/Library/Mobile Documents/com~apple~CloudDocs/HomeServerBackups/guess-pokemon'
readonly AGE_RECIPIENT_FILE="${APP_DIR}/backup-age-recipient-v1.txt"
readonly HEARTBEAT_CONFIG_FILE="${APP_DIR}/backup-heartbeats.conf"
readonly RUNTIME_CONFIG_ROOT="${APP_DIR}/runtime-config"
readonly RUNTIME_CONFIG_RELEASES="${RUNTIME_CONFIG_ROOT}/releases"
readonly RUNTIME_CONFIG_STATE="${RUNTIME_CONFIG_ROOT}/state"
readonly RUNTIME_CONFIG_CURRENT="${RUNTIME_CONFIG_ROOT}/current"
readonly RUNTIME_CONFIG_INITIALIZED="${APP_DIR}/.runtime-config-v2-initialized"
readonly ZERO_SHA=0000000000000000000000000000000000000000
readonly ZERO_DIGEST=sha256:0000000000000000000000000000000000000000000000000000000000000000

work_dir=
final_dir=
active_compose_file=
offsite_partial=
offsite_staged=false
local_heartbeat_url=
icloud_stage_heartbeat_url=
trigger=scheduled

usage() {
  printf 'Usage: backup-guess-pokemon.sh [--trigger scheduled|predeploy]\n' >&2
}

fail() {
  printf 'Guess Pokémon DB backup failed: %s\n' "$1" >&2
  exit 1
}

private_file_mode() {
  "${PYTHON_BIN}" - "$1" <<'PY'
import os
import stat
import sys

print(oct(stat.S_IMODE(os.stat(sys.argv[1]).st_mode))[2:])
PY
}

prepare_private_directory() {
  local directory="$1"

  if [[ -L "${directory}" ]] \
    || { [[ -e "${directory}" ]] && [[ ! -d "${directory}" ]]; }
  then
    fail "backup directory is unsafe"
  fi
  /bin/mkdir -p "${directory}"
  if [[ -L "${directory}" || ! -d "${directory}" ]]; then
    fail "backup directory is unsafe"
  fi
  /bin/chmod 700 "${directory}"
}

cleanup() {
  if [[ -n "${offsite_partial}" && -f "${offsite_partial}" ]]; then
    /bin/unlink "${offsite_partial}" || true
  fi
  if [[ -n "${work_dir}" && -d "${work_dir}" ]]; then
    printf 'Partial backup remains for inspection: %s\n' "${work_dir}" >&2
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --trigger)
      if [[ "$#" -lt 2 ]]; then
        usage
        exit 64
      fi
      trigger="$2"
      shift 2
      ;;
    *)
      usage
      exit 64
      ;;
  esac
done

if [[ "${trigger}" != scheduled && "${trigger}" != predeploy ]]; then
  usage
  exit 64
fi

validate_heartbeat_url() {
  local value="$1"

  if printf '%s' "${value}" | /usr/bin/grep -q '[[:space:]]'; then
    return 1
  fi
  case "${value}" in
    https://*/api/push/*|http://127.0.0.1:*/api/push/*|http://localhost:*/api/push/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

load_heartbeat_config() {
  local file_mode
  local line
  local local_seen=false
  local icloud_seen=false

  if [[ ! -e "${HEARTBEAT_CONFIG_FILE}" && ! -L "${HEARTBEAT_CONFIG_FILE}" ]]; then
    return 0
  fi
  if [[ ! -f "${HEARTBEAT_CONFIG_FILE}" || -L "${HEARTBEAT_CONFIG_FILE}" ]]; then
    fail "backup heartbeat configuration is missing or unsafe"
  fi
  file_mode="$(private_file_mode "${HEARTBEAT_CONFIG_FILE}")"
  if [[ "${file_mode}" != 600 ]]; then
    fail "backup heartbeat configuration mode must be 600"
  fi

  while IFS= read -r line || [[ -n "${line}" ]]; do
    case "${line}" in
      LOCAL_HEARTBEAT_URL=*)
        if [[ "${local_seen}" == true ]]; then
          fail "backup heartbeat configuration contains duplicate keys"
        fi
        local_seen=true
        local_heartbeat_url="${line#LOCAL_HEARTBEAT_URL=}"
        ;;
      ICLOUD_STAGE_HEARTBEAT_URL=*)
        if [[ "${icloud_seen}" == true ]]; then
          fail "backup heartbeat configuration contains duplicate keys"
        fi
        icloud_seen=true
        icloud_stage_heartbeat_url="${line#ICLOUD_STAGE_HEARTBEAT_URL=}"
        ;;
      *)
        fail "backup heartbeat configuration contains unexpected content"
        ;;
    esac
  done <"${HEARTBEAT_CONFIG_FILE}"

  if [[ "${local_seen}" != true || "${icloud_seen}" != true ]] \
    || ! validate_heartbeat_url "${local_heartbeat_url}" \
    || ! validate_heartbeat_url "${icloud_stage_heartbeat_url}"
  then
    fail "backup heartbeat configuration is incomplete or invalid"
  fi
}

send_heartbeat() {
  local channel="$1"
  local url

  case "${channel}" in
    local)
      url="${local_heartbeat_url}"
      ;;
    icloud-stage)
      url="${icloud_stage_heartbeat_url}"
      ;;
    *)
      return 64
      ;;
  esac
  if [[ -z "${url}" ]]; then
    return 0
  fi
  if [[ ! -x "${CURL_BIN}" ]] \
    || ! "${CURL_BIN}" \
      --fail \
      --silent \
      --connect-timeout 3 \
      --max-time 10 \
      "${url}" \
      >/dev/null 2>&1
  then
    printf 'Backup heartbeat delivery failed: %s\n' "${channel}" >&2
    return 1
  fi
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

load_heartbeat_config

if [[ ! -f "${ENV_FILE}" || -L "${ENV_FILE}" ]]; then
  fail "production environment configuration is missing or unsafe"
fi

active_compose_file="$(select_compose_file)"
prepare_private_directory "${BACKUP_DIR}"

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

started_at="$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')"
timestamp="$(/bin/date -u '+%Y%m%dT%H%M%SZ')"
work_dir="$(
  /usr/bin/mktemp -d "${BACKUP_DIR}/.guess-pokemon-backup.XXXXXX"
)"
final_dir="${BACKUP_DIR}/guess-pokemon-production-${timestamp}"
db_dump_file="${work_dir}/database/dump"
db_version_file="${work_dir}/database/version.txt"
record_counts_file="${work_dir}/database/record-counts.tsv"
archive_list_file="${work_dir}/database/.archive.list"

if [[ -e "${final_dir}" ]]; then
  fail "backup with the same timestamp already exists"
fi
/bin/mkdir -p "${work_dir}/database" "${work_dir}/files"
: >"${work_dir}/files/sha256.txt"

# Variables expand inside the database container, not in this host shell.
# shellcheck disable=SC2016
compose exec -T db /bin/sh -ceu '
  # BACKUP_QUERY=dump
  exec pg_dump \
    --format=custom \
    --no-owner \
    --no-privileges \
    --username "${POSTGRES_USER}" \
    --dbname "${POSTGRES_DB}"
' >"${db_dump_file}"

if [[ ! -s "${db_dump_file}" ]]; then
  fail "generated archive is empty"
fi

compose exec -T db pg_restore --list \
  <"${db_dump_file}" \
  >"${archive_list_file}"

# Variables expand inside the database container, not in this host shell.
# shellcheck disable=SC2016
compose exec -T db /bin/sh -ceu '
  # BACKUP_QUERY=version
  exec psql \
    --username "${POSTGRES_USER}" \
    --dbname "${POSTGRES_DB}" \
    --no-align \
    --tuples-only \
    --command "SHOW server_version"
' >"${db_version_file}"

# pg_restore emits the data saved in the custom archive without connecting to
# a database. Counting its COPY stream keeps recordCounts on the pg_dump
# snapshot instead of observing a newer live database state. Explicit stdout
# keeps this in script-output mode without a database target.
compose exec -T db pg_restore \
  --data-only \
  --schema=public \
  --strict-names \
  --no-owner \
  --no-privileges \
  --file=- \
  <"${db_dump_file}" \
  | "${PYTHON_BIN}" -c '
import pathlib
import re
import sys

archive_list_path = pathlib.Path(sys.argv[1])
safe_name = r"[A-Za-z0-9_]+"
copy_header = re.compile(
    rf"^COPY public\.({safe_name}) \([^)]*\) FROM stdin;$"
)

record_counts = {}
for line_number, raw_line in enumerate(
    archive_list_path.read_text(encoding="utf-8").splitlines(), start=1
):
    fields = raw_line.split()
    if (
        len(fields) >= 8
        and fields[0][:-1].isdigit()
        and fields[0].endswith(";")
        and fields[3:6] == ["TABLE", "DATA", "public"]
    ):
        table_name = fields[6]
        if not re.fullmatch(safe_name, table_name):
            raise SystemExit(f"unsupported TABLE DATA entry at TOC line {line_number}")
        if table_name in record_counts:
            raise SystemExit(f"duplicate TABLE DATA entry at TOC line {line_number}")
        record_counts[table_name] = 0
    elif " TABLE DATA public " in raw_line:
        raise SystemExit(f"unsupported TABLE DATA entry at TOC line {line_number}")

if not record_counts:
    raise SystemExit("archive public table inventory is empty")

current_table = None
seen_copy = set()
for line_number, raw_line in enumerate(sys.stdin, start=1):
    line = raw_line.rstrip("\r\n")
    if current_table is not None:
        if line == r"\.":
            current_table = None
        else:
            record_counts[current_table] += 1
        continue

    if line.startswith("COPY "):
        match = copy_header.fullmatch(line)
        if not match:
            raise SystemExit(f"unsupported COPY header at data line {line_number}")
        table_name = match.group(1)
        if table_name not in record_counts or table_name in seen_copy:
            raise SystemExit(f"unexpected COPY table at data line {line_number}")
        seen_copy.add(table_name)
        current_table = table_name

if current_table is not None:
    raise SystemExit("archive COPY stream is truncated")
if seen_copy != set(record_counts):
    raise SystemExit("archive COPY stream does not cover every public table")

for table_name in sorted(record_counts):
    print(f"{table_name}\t{record_counts[table_name]}")
' "${archive_list_file}" >"${record_counts_file}"

/bin/unlink "${archive_list_file}"

application_sha=unknown
runtime_config_digest=unknown
if [[ -f "${RUNTIME_CONFIG_STATE}" && ! -L "${RUNTIME_CONFIG_STATE}" ]]; then
  application_sha="$(read_state_value APPLICATION_REVISION)"
  runtime_config_digest="$(read_state_value RUNTIME_CONFIG_DIGEST)"
fi
completed_at="$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')"

"${PYTHON_BIN}" - \
  "${work_dir}" \
  "${trigger}" \
  "${started_at}" \
  "${completed_at}" \
  "${application_sha}" \
  "${runtime_config_digest}" \
  "${db_version_file}" \
  "${record_counts_file}" <<'PY'
import hashlib
import json
import pathlib
import re
import sys

(
    work_dir_value,
    trigger,
    started_at,
    completed_at,
    application_sha,
    runtime_config_digest,
    version_file_value,
    record_counts_file_value,
) = sys.argv[1:]
work_dir = pathlib.Path(work_dir_value)
dump_file = work_dir / "database" / "dump"
if not dump_file.is_file() or dump_file.is_symlink():
    raise SystemExit("database dump is missing or unsafe")
if application_sha != "unknown" and not re.fullmatch(r"[0-9a-f]{40}", application_sha):
    raise SystemExit("application revision has an unexpected format")
if runtime_config_digest != "unknown" and not re.fullmatch(
    r"sha256:[0-9a-f]{64}", runtime_config_digest
):
    raise SystemExit("runtime config digest has an unexpected format")

record_counts = {}
for raw_line in pathlib.Path(record_counts_file_value).read_text(encoding="utf-8").splitlines():
    table_name, separator, count_value = raw_line.partition("\t")
    if separator != "\t" or not re.fullmatch(r"[A-Za-z0-9_]+", table_name):
        raise SystemExit("database record count inventory is invalid")
    if table_name in record_counts or not count_value.isdigit():
        raise SystemExit("database record count inventory is invalid")
    record_counts[table_name] = int(count_value)
if not record_counts:
    raise SystemExit("database record count inventory is empty")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


manifest = {
    "schemaVersion": 1,
    "status": "success",
    "project": "guess-pokemon",
    "environment": "production",
    "trigger": trigger,
    "startedAt": started_at,
    "completedAt": completed_at,
    "source": {
        "applicationSha": application_sha,
        "runtimeConfigDigest": runtime_config_digest,
    },
    "database": {
        "engine": "postgresql",
        "version": pathlib.Path(version_file_value).read_text(encoding="utf-8").strip(),
        "dumpFile": "database/dump",
        "bytes": dump_file.stat().st_size,
        "sha256": sha256(dump_file),
        "validator": "pg_restore --list",
        "recordCounts": dict(sorted(record_counts.items())),
        "recordCountsSource": "database/dump",
    },
    "files": {
        "enabled": False,
        "directory": None,
        "count": 0,
        "bytes": 0,
        "manifest": "files/sha256.txt",
    },
}
if not manifest["database"]["version"]:
    raise SystemExit("database version is empty")
(work_dir / "manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
PY

# SUCCESS는 archive, inventory와 manifest 검증이 끝난 뒤 마지막으로 생성한다.
printf 'snapshot complete\n' >"${work_dir}/SUCCESS"
/bin/mv "${work_dir}" "${final_dir}"
work_dir=

"${PYTHON_BIN}" - "${BACKUP_DIR}" <<'PY'
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import tempfile
import sys

root = pathlib.Path(sys.argv[1])
pattern = re.compile(r"guess-pokemon-production-(\d{8}T\d{6}Z)")
valid = []
invalid = []

def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

for candidate in sorted(root.iterdir()):
    match = pattern.fullmatch(candidate.name)
    if not match or candidate.is_symlink() or not candidate.is_dir():
        continue
    try:
        success = candidate / "SUCCESS"
        manifest_path = candidate / "manifest.json"
        if (
            not success.is_file()
            or success.is_symlink()
            or not manifest_path.is_file()
            or manifest_path.is_symlink()
        ):
            raise ValueError("marker or manifest missing")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if (
            manifest.get("schemaVersion") != 1
            or manifest.get("status") != "success"
            or manifest.get("project") != "guess-pokemon"
            or manifest.get("environment") != "production"
        ):
            raise ValueError("manifest identity mismatch")
        database = manifest.get("database")
        if not isinstance(database, dict):
            raise ValueError("database contract missing")
        if (
            database.get("engine") != "postgresql"
            or not isinstance(database.get("version"), str)
            or not database["version"]
            or database.get("validator") != "pg_restore --list"
            or database.get("dumpFile") != "database/dump"
            or type(database.get("bytes")) is not int
            or database["bytes"] < 1
        ):
            raise ValueError("database contract mismatch")
        if database.get("recordCountsSource") != "database/dump":
            raise ValueError("record count source mismatch")
        record_counts = database.get("recordCounts")
        if not isinstance(record_counts, dict) or not record_counts:
            raise ValueError("record count inventory missing")
        for table_name, row_count in record_counts.items():
            if (
                not re.fullmatch(r"[A-Za-z0-9_]+", table_name)
                or type(row_count) is not int
                or row_count < 0
            ):
                raise ValueError("record count inventory invalid")

        dump = candidate / database["dumpFile"]
        if not dump.is_file() or dump.is_symlink():
            raise ValueError("dump missing")
        if dump.stat().st_size != database["bytes"]:
            raise ValueError("dump size mismatch")
        if sha256(dump) != database["sha256"]:
            raise ValueError("dump checksum mismatch")
        files = manifest.get("files")
        if not isinstance(files, dict):
            raise ValueError("file contract missing")
        checksum_file = candidate / files["manifest"]
        if (
            files.get("enabled") is not False
            or files.get("directory") is not None
            or files.get("manifest") != "files/sha256.txt"
            or type(files.get("count")) is not int
            or files["count"] != 0
            or type(files.get("bytes")) is not int
            or files["bytes"] != 0
            or not checksum_file.is_file()
            or checksum_file.is_symlink()
            or checksum_file.stat().st_size != 0
        ):
            raise ValueError("disabled file inventory mismatch")
        timestamp = dt.datetime.strptime(match.group(1), "%Y%m%dT%H%M%SZ").replace(
            tzinfo=dt.timezone.utc
        )
        valid.append((timestamp, candidate.name))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        invalid.append(candidate.name)

valid.sort(reverse=True)
keep = {name for _, name in valid[:4]}
kst = dt.timezone(dt.timedelta(hours=9))
today = dt.datetime.now(dt.timezone.utc).astimezone(kst).date()
for offset in range(1, 8):
    target_date = today - dt.timedelta(days=offset)
    eligible = [
        (timestamp, name)
        for timestamp, name in valid
        if timestamp.astimezone(kst).date() == target_date
        and timestamp.astimezone(kst).time() >= dt.time(6, 0)
    ]
    if eligible:
        keep.add(min(eligible)[1])

plan = {
    "schemaVersion": 1,
    "project": "guess-pokemon",
    "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
    "mode": "dry-run",
    "policy": {"recent": 4, "dailyAtOrAfterKst": "06:00", "dailyDays": 7},
    "keep": sorted(keep),
    "pruneCandidates": sorted(name for _, name in valid if name not in keep),
    "invalidIgnored": sorted(invalid),
}
handle = tempfile.NamedTemporaryFile(
    mode="w",
    encoding="utf-8",
    dir=root,
    prefix=".retention-plan.",
    delete=False,
)
try:
    json.dump(plan, handle, ensure_ascii=False, indent=2, sort_keys=True)
    handle.write("\n")
    handle.flush()
    os.fchmod(handle.fileno(), 0o600)
    handle.close()
    os.replace(handle.name, root / "retention-plan.json")
except BaseException:
    handle.close()
    pathlib.Path(handle.name).unlink(missing_ok=True)
    raise
PY

stage_offsite_snapshot() {
  local ciphertext
  local ciphertext_sha
  local icloud_final
  local icloud_final_sha
  local local_partial
  local offsite_copy_sha
  local snapshot_name

  if [[ ! -x "${AGE_BIN}" ]] \
    || [[ ! -f "${AGE_RECIPIENT_FILE}" ]] \
    || [[ -L "${AGE_RECIPIENT_FILE}" ]]
  then
    printf 'Offsite stage skipped: age recipient is not installed\n' >&2
    return 0
  fi
  if ! /usr/bin/grep -Eq '^age1[0-9a-z]+$' "${AGE_RECIPIENT_FILE}" \
    || [[ "$(/usr/bin/wc -l <"${AGE_RECIPIENT_FILE}" | /usr/bin/tr -d ' ')" != 1 ]]
  then
    printf 'Offsite stage failed: age recipient file is invalid\n' >&2
    return 1
  fi
  if [[ "$(private_file_mode "${AGE_RECIPIENT_FILE}")" != 600 ]]; then
    printf 'Offsite stage failed: age recipient file mode must be 600\n' >&2
    return 1
  fi

  for directory in "${OFFSITE_STAGING_ROOT}" "${ICLOUD_ROOT}"; do
    if [[ -L "${directory}" ]] \
      || { [[ -e "${directory}" ]] && [[ ! -d "${directory}" ]]; }
    then
      printf 'Offsite stage failed: target directory is unsafe\n' >&2
      return 1
    fi
    if ! /bin/mkdir -p "${directory}" \
      || [[ -L "${directory}" ]] \
      || [[ ! -d "${directory}" ]] \
      || ! /bin/chmod 700 "${directory}"
    then
      printf 'Offsite stage failed: target directory preparation failed\n' >&2
      return 1
    fi
  done

  if ! snapshot_name="$(/usr/bin/basename "${final_dir}")" \
    || [[ -z "${snapshot_name}" ]]
  then
    printf 'Offsite stage failed: snapshot name resolution failed\n' >&2
    return 1
  fi
  ciphertext="${OFFSITE_STAGING_ROOT}/${snapshot_name}.tar.age"
  icloud_final="${ICLOUD_ROOT}/${snapshot_name}.tar.age"
  if [[ -e "${ciphertext}" || -L "${ciphertext}" ]]; then
    printf 'Offsite stage failed: local ciphertext already exists\n' >&2
    return 1
  fi

  if ! local_partial="$(
    /usr/bin/mktemp "${OFFSITE_STAGING_ROOT}/.${snapshot_name}.XXXXXX.partial"
  )"
  then
    printf 'Offsite stage failed: local ciphertext staging failed\n' >&2
    return 1
  fi
  if [[ ! -f "${local_partial}" || -L "${local_partial}" ]] \
    || ! /bin/chmod 600 "${local_partial}"
  then
    if [[ -f "${local_partial}" && ! -L "${local_partial}" ]]; then
      /bin/unlink "${local_partial}" || true
    fi
    printf 'Offsite stage failed: local ciphertext staging failed\n' >&2
    return 1
  fi
  if ! /usr/bin/tar -C "${BACKUP_DIR}" -cf - "${snapshot_name}" \
    | "${AGE_BIN}" -R "${AGE_RECIPIENT_FILE}" >"${local_partial}"
  then
    /bin/unlink "${local_partial}" || true
    printf 'Offsite stage failed: age encryption failed\n' >&2
    return 1
  fi
  if [[ ! -s "${local_partial}" ]] \
    || ! /usr/bin/head -n 1 "${local_partial}" \
      | /usr/bin/grep -Fqx 'age-encryption.org/v1'
  then
    /bin/unlink "${local_partial}" || true
    printf 'Offsite stage failed: ciphertext validation failed\n' >&2
    return 1
  fi
  if ! /bin/mv "${local_partial}" "${ciphertext}"; then
    /bin/unlink "${local_partial}" || true
    printf 'Offsite stage failed: local ciphertext publish failed\n' >&2
    return 1
  fi
  local_partial=
  if [[ ! -f "${ciphertext}" || -L "${ciphertext}" ]]; then
    printf 'Offsite stage failed: local ciphertext publish validation failed\n' >&2
    return 1
  fi

  if ! ciphertext_sha="$(
    /usr/bin/shasum -a 256 "${ciphertext}" | /usr/bin/awk '{print $1}'
  )" \
    || [[ -z "${ciphertext_sha}" ]]
  then
    printf 'Offsite stage failed: local ciphertext checksum unavailable\n' >&2
    return 1
  fi
  if [[ -e "${icloud_final}" || -L "${icloud_final}" ]]; then
    if [[ ! -f "${icloud_final}" || -L "${icloud_final}" ]]; then
      printf 'Offsite stage failed: iCloud target collision\n' >&2
      return 1
    fi
    if ! icloud_final_sha="$(
      /usr/bin/shasum -a 256 "${icloud_final}" | /usr/bin/awk '{print $1}'
    )" \
      || [[ -z "${icloud_final_sha}" ]]
    then
      printf 'Offsite stage failed: iCloud final checksum unavailable\n' >&2
      return 1
    fi
    if [[ "${icloud_final_sha}" != "${ciphertext_sha}" ]]; then
      printf 'Offsite stage failed: iCloud target collision\n' >&2
      return 1
    fi
  else
    if ! offsite_partial="$(
      /usr/bin/mktemp "${ICLOUD_ROOT}/.${snapshot_name}.XXXXXX.partial"
    )"
    then
      printf 'Offsite stage failed: iCloud partial creation failed\n' >&2
      return 1
    fi
    if [[ ! -f "${offsite_partial}" || -L "${offsite_partial}" ]] \
      || ! /bin/cp "${ciphertext}" "${offsite_partial}" \
      || ! /bin/chmod 600 "${offsite_partial}"
    then
      printf 'Offsite stage failed: iCloud partial staging failed\n' >&2
      return 1
    fi
    if ! offsite_copy_sha="$(
      /usr/bin/shasum -a 256 "${offsite_partial}" | /usr/bin/awk '{print $1}'
    )" \
      || [[ -z "${offsite_copy_sha}" ]] \
      || [[ "${offsite_copy_sha}" != "${ciphertext_sha}" ]]
    then
      printf 'Offsite stage failed: iCloud handoff checksum mismatch\n' >&2
      return 1
    fi
    if ! /bin/mv "${offsite_partial}" "${icloud_final}"; then
      printf 'Offsite stage failed: iCloud final publish failed\n' >&2
      return 1
    fi
    offsite_partial=
    if [[ ! -f "${icloud_final}" || -L "${icloud_final}" ]]; then
      printf 'Offsite stage failed: iCloud final validation failed\n' >&2
      return 1
    fi
    if ! icloud_final_sha="$(
      /usr/bin/shasum -a 256 "${icloud_final}" | /usr/bin/awk '{print $1}'
    )" \
      || [[ -z "${icloud_final_sha}" ]] \
      || [[ "${icloud_final_sha}" != "${ciphertext_sha}" ]]
    then
      printf 'Offsite stage failed: iCloud final checksum mismatch\n' >&2
      return 1
    fi
  fi

  if ! /bin/unlink "${ciphertext}"; then
    printf 'Offsite stage warning: local ciphertext cleanup failed\n' >&2
  fi
  offsite_staged=true
  printf 'OFFSITE_QUEUED=%s\n' "${icloud_final}"
  return 0
}

printf 'Backup completed: %s\n' "${final_dir}"
printf 'Retention dry-run plan: %s\n' "${BACKUP_DIR}/retention-plan.json"
send_heartbeat local || true
if ! stage_offsite_snapshot; then
  if [[ "${trigger}" == predeploy ]]; then
    printf 'Predeploy continues because the verified local snapshot succeeded\n' >&2
  else
    fail "local snapshot succeeded but offsite staging failed"
  fi
fi
if [[ "${offsite_staged}" == true ]]; then
  send_heartbeat icloud-stage || true
fi
