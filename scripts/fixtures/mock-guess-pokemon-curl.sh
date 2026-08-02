#!/bin/bash

set -Eeuo pipefail

url=
for argument in "$@"; do
  url="${argument}"
done

if [[ -n "${FAKE_CURL_LOG:-}" ]]; then
  printf '%s\n' "${url}" >>"${FAKE_CURL_LOG}"
fi

if [[ "${FAKE_PUBLIC_SMOKE_FAIL:-false}" == true ]]; then
  exit 22
fi

if [[ -n "${FAKE_PUBLIC_SMOKE_FAIL_ONCE_FILE:-}" ]] \
  && [[ ! -e "${FAKE_PUBLIC_SMOKE_FAIL_ONCE_FILE}" ]]
then
  : >"${FAKE_PUBLIC_SMOKE_FAIL_ONCE_FILE}"
  exit 22
fi

case "${url}" in
  https://guess-pokemon.chochiho.cloud/)
    printf '%s\n' '<html><script type="module" src="/assets/index-test.js"></script></html>'
    ;;
  https://guess-pokemon.chochiho.cloud/actuator/health/readiness)
    printf '%s\n' '{"status":"UP"}'
    ;;
  *)
    printf '%s\n' 'ok'
    ;;
esac
