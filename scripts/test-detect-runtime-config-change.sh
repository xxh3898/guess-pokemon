#!/bin/bash

set -Eeuo pipefail

readonly PROJECT_ROOT="$(
  CDPATH= cd -- "$(dirname -- "$0")/.." && pwd
)"
readonly DETECTOR="${PROJECT_ROOT}/scripts/detect-runtime-config-change.sh"

test_root="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/guess-pokemon-runtime-detector-test.XXXXXX")"

cleanup() {
  if [[ "$(/usr/bin/basename "${test_root}")" == guess-pokemon-runtime-detector-test.* ]]; then
    /bin/rm -rf -- "${test_root}"
  fi
}

trap cleanup EXIT INT TERM

git -C "${test_root}" init --quiet
git -C "${test_root}" config user.email test@example.invalid
git -C "${test_root}" config user.name "Runtime Config Test"

for path in \
  .dockerignore \
  compose.production.yaml \
  infra/nginx/cloudflare-edge-real-ip.conf \
  runtime-config.Dockerfile \
  scripts/backup-production-db.sh \
  scripts/deploy-guess-pokemon.sh \
  frontend/src/App.tsx
do
  /bin/mkdir -p "$(/usr/bin/dirname "${test_root}/${path}")"
  printf 'base\n' >"${test_root}/${path}"
done

git -C "${test_root}" add .
git -C "${test_root}" commit --quiet -m base
before_sha="$(git -C "${test_root}" rev-parse HEAD)"

assert_mode_after_change() {
  local expected_mode="$1"
  local changed_path="$2"
  local changed_sha
  local actual_mode

  printf 'changed\n' >>"${test_root}/${changed_path}"
  git -C "${test_root}" add "${changed_path}"
  git -C "${test_root}" commit --quiet -m "change ${changed_path}"
  changed_sha="$(git -C "${test_root}" rev-parse HEAD)"
  actual_mode="$(
    (
      cd "${test_root}"
      /bin/bash "${DETECTOR}" "${before_sha}" "${changed_sha}" false
    )
  )"
  if [[ "${actual_mode}" != "${expected_mode}" ]]; then
    printf 'Expected %s for %s, got %s\n' \
      "${expected_mode}" \
      "${changed_path}" \
      "${actual_mode}" \
      >&2
    exit 1
  fi

  before_sha="${changed_sha}"
}

for runtime_path in \
  .dockerignore \
  compose.production.yaml \
  infra/nginx/cloudflare-edge-real-ip.conf \
  runtime-config.Dockerfile \
  scripts/backup-production-db.sh \
  scripts/deploy-guess-pokemon.sh
do
  assert_mode_after_change update "${runtime_path}"
done

assert_mode_after_change keep frontend/src/App.tsx

test "$(
  cd "${test_root}"
  /bin/bash "${DETECTOR}" \
    0000000000000000000000000000000000000000 \
    "${before_sha}" \
    false
)" = update

test "$(
  cd "${test_root}"
  /bin/bash "${DETECTOR}" "${before_sha}" "${before_sha}" true
)" = update

printf 'Guess Pokémon runtime config detector tests passed\n'
