# Guess Pokémon 운영 가이드

- 작성일: 2026-07-25
- 대상: Docker Compose 기반 MacBook 통합 테스트와 Mac mini 단일 서버 운영
- 비범위: 운영 배포 실행, 운영 DB restore 실행

## 1. 운영 원칙

- 저장소의 `compose.yaml`을 기본 구성으로 사용하고 외부 공개가 필요할 때만 `compose.tunnel.yaml`을 함께 사용한다.
- Quick Tunnel과 named tunnel은 동시에 실행하지 않는다.
- Quick Tunnel은 격리된 임시 DB를 사용하는 통합 테스트에만 사용한다.
- MacBook 개발 project와 Mac mini 운영 project는 DB 이름, 계정, 비밀번호, Compose project name, volume을 공유하지 않는다.
- 실제 token, 비밀번호, `.env`, backup archive는 Git에 추가하지 않는다.
- 운영 DB 변경, restore, volume 삭제, service 재시작, 배포는 실행 직전에 대상과 backup을 다시 확인한다.

## 2. 구성 경계

```text
browser HTTPS/WSS
  -> Cloudflare edge
  -> cloudflared
  -> tunnel-origin network
  -> web:80
  -> default network
  -> api:8080
  -> db:5432
```

- `cloudflared`는 `tunnel-origin` network에만 참여하고 `api`, `db`에 직접 연결하지 않는다.
- `web`만 두 network에 참여한다.
- Tunnel 구성의 host origin port는 `127.0.0.1`에만 bind한다.
- PostgreSQL port는 host에 publish하지 않는다.
- Nginx는 고정한 connector 주소에서 온 `CF-Connecting-IP`만 client IP로 신뢰한다.
- Tunnel 구성은 API session cookie의 `Secure` 값을 항상 `true`로 강제한다.

`tunnel-origin`은 `172.30.77.0/29`를 사용한다. 이미 같은 subnet을 쓰는 Docker network가 있으면 Tunnel을 실행하지 말고 network 충돌을 먼저 해결한다. subnet을 임의로 바꾸면 `compose.tunnel.yaml`과 `infra/nginx/cloudflare-real-ip.conf`의 신뢰 주소도 함께 검토해야 한다.

## 3. 사전 구성 검증

환경 파일을 만든 뒤 service를 시작하기 전에 네 가지 Compose 병합 결과를 검사한다.

```bash
ENV_FILE=.env ./scripts/verify-compose.sh
```

이 명령은 base, dev, Quick Tunnel, named tunnel 구성을 render할 뿐 container를 시작하지 않는다.

named tunnel을 시작하기 전에는 token file 존재 여부도 확인한다.

```bash
ENV_FILE=.env ./scripts/verify-compose.sh named
```

`COMPOSE_PROFILES`에 `quick-tunnel,named-tunnel`을 함께 지정하면 검증을 실패시킨다.

## 4. Quick Tunnel 통합 테스트

Quick Tunnel은 무작위 `trycloudflare.com` 주소를 만들고 별도 인증 계층 없이 외부에 공개한다. 실제 사용자 데이터가 없는 격리 project에서만 짧게 실행한다.

### 4.1 격리 환경 파일

`.env.example`을 Git에서 제외되는 별도 파일로 복사한다.

```bash
cp .env.example .env.tunnel-smoke
```

`.env.tunnel-smoke`에서 아래 값을 개발 환경과 다르게 정한다.

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `TUNNEL_ORIGIN_PORT`

예시 비밀번호를 그대로 사용하지 않는다.

### 4.2 실행

```bash
ENV_FILE=.env.tunnel-smoke ./scripts/verify-compose.sh

docker compose \
  --project-name guess-pokemon-tunnel-smoke \
  --env-file .env.tunnel-smoke \
  --file compose.yaml \
  --file compose.tunnel.yaml \
  --profile quick-tunnel \
  up --build
```

`cloudflared-quick` log에 표시된 `https://...trycloudflare.com` 주소를 사용한다. Quick Tunnel에는 운영 주소, 실제 token, 실제 사용자 데이터를 연결하지 않는다.

### 4.3 HTTPS·REST·WSS 자동 검증

다음 검증은 대상 DB에 임시 회원 두 명과 방 하나를 만든다. 반드시 격리 project인지 확인한다.

```bash
QUICK_TUNNEL_URL=https://example.trycloudflare.com \
docker compose \
  --file compose.test.yaml \
  run --rm \
  --env QUICK_TUNNEL_URL \
  backend-test \
  ./gradlew test \
  --tests com.guesspokemon.QuickTunnelConnectivityTest \
  --no-daemon
```

검증 범위:

- HTTPS landing과 SPA direct route
- HSTS, Permissions Policy, MIME sniffing 방지 header
- CSRF, 회원가입, 로그인, `Secure`·`HttpOnly`·`SameSite=Lax` session cookie
- 서로 다른 두 session의 방 생성·입장
- 같은 origin `wss://.../ws` STOMP 연결 두 개

### 4.4 종료

먼저 동일한 project name과 Compose 파일로 종료한다.

```bash
docker compose \
  --project-name guess-pokemon-tunnel-smoke \
  --env-file .env.tunnel-smoke \
  --file compose.yaml \
  --file compose.tunnel.yaml \
  --profile quick-tunnel \
  down
```

위 명령은 격리 PostgreSQL volume을 보존한다. volume까지 제거하려면 container와 volume의 `com.docker.compose.project` label이 정확히 `guess-pokemon-tunnel-smoke`인지 다시 확인해야 한다. 일반 개발·운영 project에는 `down --volumes`를 사용하지 않는다.

## 5. named tunnel 준비

Cloudflare가 Docker 운영에는 remotely-managed tunnel 사용을 권장한다. 이번 저장소 구성은 token file을 읽을 준비까지만 제공하며 계정, tunnel, public hostname은 자동으로 만들지 않는다.

1. Cloudflare dashboard에서 remotely-managed tunnel과 public hostname을 만든다.
2. origin service를 `http://web:80`으로 지정한다.
3. 저장소의 `secrets/` 아래에 token file을 만들고 `.env`의 `CLOUDFLARE_TUNNEL_TOKEN_FILE`로 경로를 지정한다.
4. token을 shell history, Compose command, `.env`, log, 문서에 넣지 않는다.
5. `./scripts/verify-compose.sh named`로 비어 있지 않은 일반 파일인지 확인한다.
6. 실제 연결 전에 `cloudflared-named`의 non-root UID `65532`가 Docker 안에서 token file을 읽을 수 있는지 확인한다.

로컬 Compose의 file-backed secret은 `uid`, `gid`, `mode` 지정을 보장하지 않는다. host 파일 권한과 Docker Desktop·Linux bind mount 동작이 다를 수 있으므로 token을 만들 때 아래 조건을 함께 만족시킨다.

- `secrets/` directory는 다른 host 사용자가 탐색할 수 없게 제한한다.
- token file은 symbolic link로 만들지 않는다.
- token file은 cloudflared UID가 읽을 수 있고 누구도 실행하거나 수정할 수 없게 제한한다.
- 권한을 맞추기 위해 광범위한 `chmod -R`, `chown -R`을 사용하지 않는다.

named tunnel 실행 명령은 다음과 같다.

```bash
docker compose \
  --env-file .env \
  --file compose.yaml \
  --file compose.tunnel.yaml \
  --profile named-tunnel \
  up --build --detach
```

named tunnel 실행은 실제 공개 배포와 service 변경이므로 Mac mini 대상, backup, domain route, rollback을 확인한 뒤 진행한다.

## 6. Nginx 보안 경계

- 일반 `/api` 요청: client IP별 초당 20회, burst 40
- `/api/v1/auth/login`, `/api/v1/auth/signup`: client IP별 분당 30회, burst 10
- 초과 응답: `429`
- application의 login ID·client IP별 10분 제한은 그대로 유지한다.
- HSTS는 신뢰한 Tunnel이 외부 protocol을 HTTPS로 전달한 경우에만 보낸다.
- liveness와 readiness 외 `/actuator/**`는 `404`로 숨긴다.

rate limit를 바꿀 때는 정상 게임 요청과 로그인 흐름을 먼저 측정하고 별도 변경 단위에서 조정한다.

## 7. PostgreSQL backup

`scripts/backup-db.sh`는 실행 중인 `db` container의 PostgreSQL client를 사용한다. host에 PostgreSQL을 설치하지 않는다.

기본 project를 저장소의 ignored `backups/`에 backup한다.

```bash
ENV_FILE=.env ./scripts/backup-db.sh
```

project name이나 저장 위치가 다르면 명시한다.

```bash
ENV_FILE=.env \
COMPOSE_PROJECT_NAME=guess-pokemon \
BACKUP_DIR=/absolute/backup/path \
./scripts/backup-db.sh
```

script는 다음 순서로 처리한다.

1. `db` service가 실행 중인지 확인한다.
2. private temporary file에 `pg_dump --format=custom --no-owner --no-privileges`를 기록한다.
3. `pg_restore --list`로 archive 목록을 읽을 수 있는지 검사한다.
4. 검증이 끝난 파일만 최종 이름으로 원자적으로 공개한다.
5. 같은 이름을 덮어쓰지 않고 자동 삭제도 하지 않는다.

같은 Mac mini disk에만 둔 backup은 disk 장애를 막지 못한다. 실제 운영에서는 별도 장치나 다른 위치에 추가 복사하고 복사본도 주기적으로 restore rehearsal한다.

## 8. 격리 restore rehearsal

운영 DB에 직접 restore하지 않는다. 다른 Compose project name과 별도 환경 파일로 빈 PostgreSQL volume을 먼저 만든다.

```bash
docker compose \
  --project-name guess-pokemon-restore-rehearsal \
  --env-file .env.restore-rehearsal \
  --file compose.yaml \
  up --detach db
```

archive 목록을 다시 확인한 뒤 빈 rehearsal DB에 한 transaction으로 restore한다.

```bash
docker compose \
  --project-name guess-pokemon-restore-rehearsal \
  --env-file .env.restore-rehearsal \
  --file compose.yaml \
  exec --no-TTY db \
  sh -ceu 'exec pg_restore \
    --exit-on-error \
    --single-transaction \
    --no-owner \
    --no-privileges \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB"' \
  < /absolute/backup/path/archive.dump
```

restore한 뒤 최소한 아래를 확인한다.

- Flyway migration 이력
- `app_user`, `pokemon_species`, `game`, `game_participant`, `game_action` row count
- 참가자가 조회할 수 있는 완료 경기 표본

자신이 생성하고 검증한 archive만 restore한다. archive는 source DB의 객체 생성 코드를 포함할 수 있으므로 출처를 신뢰할 수 없는 dump를 실행하지 않는다.

## 9. 시작·중지·업데이트

### 상태 확인

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs --tail 100 api web db
```

token, session ID, DB 비밀번호를 log나 지원 요청에 붙이지 않는다.

### 안전한 중지

```bash
docker compose --env-file .env down
```

named tunnel은 실행할 때와 같은 `compose.tunnel.yaml`과 profile을 지정한다. 일반 `down`은 named volume을 남긴다.

### image·source 업데이트

1. 현재 commit과 작업 트리를 확인한다.
2. DB backup과 archive 목록 검증을 완료한다.
3. 변경한 image tag·digest와 migration을 검토한다.
4. 전체 test와 image build를 통과시킨다.
5. 서비스 중단 가능 시간과 rollback commit을 정한다.
6. 승인 뒤 image를 교체하고 health와 핵심 흐름을 확인한다.

`cloudflared`는 tag와 multi-arch digest를 함께 고정한다. `latest`로 자동 갱신하지 않는다.

## 10. rollback

### source·container

- Tunnel override를 빼면 base local production-like 구성으로 돌아간다.
- source는 해당 infra commit을 revert한 뒤 image를 다시 build해 되돌린다.
- container 교체와 service restart는 실제 트래픽을 끊을 수 있으므로 별도 승인 뒤 실행한다.

### 데이터

- source rollback은 PostgreSQL volume과 backup archive를 자동으로 되돌리지 않는다.
- migration rollback이나 운영 restore가 필요하면 별도 계획, 최신 backup, rehearsal 결과를 먼저 준비한다.
- volume 삭제를 rollback 수단으로 사용하지 않는다.

### Cloudflare

- source를 되돌려도 dashboard의 public hostname, route, token은 남는다.
- 공개를 즉시 멈추려면 connector를 중지하고 Cloudflare route를 비활성화한다.
- token 노출이 의심되면 Cloudflare에서 revoke하고 새 token을 발급한다.

## 11. Mac mini 운영 전 체크리스트

- [ ] Docker Desktop 또는 승인한 Docker runtime이 로그인 뒤 시작한다.
- [ ] Mac mini 절전이 Tunnel과 WebSocket을 끊지 않게 설정한다.
- [ ] router inbound port forwarding을 열지 않는다.
- [ ] outbound TCP·UDP 7844 연결을 허용한다.
- [ ] MacBook 개발 DB와 다른 `.env`, project name, volume을 사용한다.
- [ ] 운영 session cookie가 `Secure=true`다.
- [ ] named token file 권한과 revoke 절차를 확인했다.
- [ ] DB backup과 격리 restore rehearsal을 통과했다.
- [ ] off-site backup 위치와 수동 보존 기준을 정했다.
- [ ] 실제 도메인과 Pokémon 관련 권리 범위를 검토했다.
- [ ] HTTPS, REST, WSS, PC·모바일 핵심 흐름을 확인했다.

## 12. Mac mini 공유 Tunnel 운영 구성

Mac mini 운영에서는 저장소의 `compose.production.yaml`을 단독으로
사용한다. GitHub Actions가 만든 backend·frontend image를 실행하며
Mac mini에서 source build를 수행하지 않는다.
공개 hostname은 `guess-pokemon.chochiho.cloud`이다.

```text
guess-pokemon.chochiho.cloud
  -> Cloudflare home-mini tunnel
  -> edge network의 guess-pokemon-web:80
  -> application network의 api:8080
  -> application network의 db:5432
```

- `db`, `api`는 host port와 `edge` network를 사용하지 않는다.
- `web`만 `edge`에 `guess-pokemon-web` alias로 참여한다.
- `application` network는 `internal: true`로 외부 연결을 차단한다.
- Portfolio와 Compose project, 환경 파일, DB volume을 공유하지 않는다.
- 운영 session cookie는 항상 `Secure=true`다.
- 운영 image는 backend·frontend 모두 같은 40자리 commit SHA tag를
  사용한다.

공유 `cloudflared` connector는 `edge` network의 `172.18.0.2`에
고정해야 한다. `infra/nginx/cloudflare-edge-real-ip.conf`는 이 한
주소만 `CF-Connecting-IP` 전달자로 신뢰한다. connector 주소를 고정하지
않고 container를 재생성하면 HSTS와 client IP별 rate limit가 의도대로
작동하지 않는다.

운영 환경 예시는 `.env.production.example`이다. 실제
`POSTGRES_PASSWORD`와 image SHA는
`/Users/homeserver/Server/apps/guess-pokemon/.env`에만 저장하고
파일 mode를 `600`으로 제한한다.

container를 시작하지 않고 운영 구성을 확인한다.

```bash
docker compose \
  --env-file .env.production.example \
  --file compose.production.yaml \
  config --quiet
```

첫 배포 전에 MacBook DB의 최신 custom-format backup을 만들고 격리
restore rehearsal을 통과해야 한다. 운영 DB restore, connector 재생성,
public hostname 추가는 각각 대상과 rollback을 확인한 뒤 실행한다.

## 13. GitHub Actions 자동 배포

- `dev` push와 `main` 대상 PR은 `.github/workflows/validate.yml`에서
  frontend, backend, infra, Nginx 검증과 두 ARM64 image build를 실행한다.
- `main` push에서만 두 ARM64 image를 GHCR에 같은 commit SHA로 발행한다.
- 두 image 발행이 모두 끝나야 Tailscale OIDC와 제한된 SSH key로
  `home-mini`에 연결한다.
- forced command wrapper는
  `deploy-guess-pokemon <40자리-sha> <registry-user>`만 허용한다.
- Mac mini deploy script는 GHCR token을 임시 Docker config에만 쓰고
  종료 시 정리한다.

배포 순서는 다음과 같다.

1. 두 SHA image를 pull하고 production Compose를 render한다.
2. DB가 실행 중인지 확인한다.
3. 진행 중 game이 1건 이상이면 배포를 중단한다.
4. custom-format DB backup과 archive 검증을 완료한다.
5. API·web image tag를 함께 갱신한다.
6. 전체 service health를 제한 시간 동안 기다린다.
7. 실패하면 이전 API·web SHA를 함께 복구한다.

image rollback은 PostgreSQL volume을 삭제하지 않는다. Flyway가 새
schema를 적용한 경우 DB migration은 자동으로 rollback하지 않는다.
migration 호환성 문제가 있으면 배포 전 backup과 별도 restore 계획을
사용한다.

## 14. 운영 backup과 3일 보존

`scripts/backup-production-db.sh`를 Mac mini의
`/Users/homeserver/Server/scripts/backup/backup-guess-pokemon.sh`로
설치한다.

- 실행 중인 production DB만 대상으로 한다.
- mode `600`의 temporary file에 custom-format dump를 기록한다.
- `pg_restore --list`가 성공한 archive만 최종 이름으로 공개한다.
- 새 backup이 성공한 뒤 3일을 초과한 Guess Pokémon archive만 정리한다.
- 정확히
  `guess-pokemon-production-YYYYMMDDTHHMMSSZ.dump` 형식인 파일만
  정리 대상이다.
- 최신 backup과 다른 프로젝트 backup은 건드리지 않는다.

같은 Mac mini SSD의 backup은 장비 전체 장애를 복구하지 못한다.
외장 SSD 또는 암호화한 원격 복사본은 별도 작업으로 추가한다.

## 15. 참고 문서

- [Cloudflare Tunnel 설정](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- [Cloudflare HTTP 요청 header](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
- [Docker Compose profile](https://docs.docker.com/compose/how-tos/profiles/)
- [Docker Compose secret](https://docs.docker.com/compose/how-tos/use-secrets/)
- [PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)
- [PostgreSQL pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html)
