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
- [ ] age/iCloud remote decrypt와 격리 restore drill을 통과했다.
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

api
  -> egress network
  -> raw.githubusercontent.com:443
```

- `db`, `api`는 host port와 `edge` network를 사용하지 않는다.
- `db`는 `application` network에만 참여한다.
- `api`는 DB 통신용 `application`과 프로젝트 전용 `egress` bridge에만
  참여한다. application code의 scheme·host allowlist가 실루엣 원본
  요청을 `https://raw.githubusercontent.com`으로 제한한다.
- `web`만 `edge`에 `guess-pokemon-web` alias로 참여한다.
- `application` network는 `internal: true`로 외부 연결을 차단하고
  `egress`에는 DB와 Web을 연결하지 않는다.
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
  frontend, backend, infra, Nginx 검증과 API·Web ARM64 image build를 실행한다.
- frontend, backend, infra, API image, Web image 검증은 독립 job으로
  실행해 서로 기다리지 않는다.
- `Detect changes`가 push 이전 SHA 또는 PR base SHA와 현재 SHA를 비교한다.
  필수 check 5개는 항상 생성하고 관련 없는 job은 no-op으로 성공 처리한다.
- `Detect changes`가 실패해도 필수 check 5개는 `always()`로 실행하며
  change detection 실패를 각 check 실패로 전파한다.
- `frontend/**` 변경은 frontend 검사·image만, `backend/**` 변경은
  backend 검사·image만 실제 실행한다. `infra/nginx/default.conf` 변경은
  infrastructure 검사와 frontend runtime image를 함께 검증한다.
- workflow, `.dockerignore`, `compose.test.yaml`, 변경 감지 script 변경은
  분류 안전성을 위해 전체 검증을 실행한다.
- 분류되지 않은 새 build/runtime path도 누락을 막기 위해 전체 검증으로
  fail-safe fallback한다. `AGENTS.md`, `.editorconfig`, `.gitignore`처럼
  build·checkout에 영향을 주지 않는 명시적 metadata만 heavy step을 모두
  safe skip한다. text·line-ending·filter checkout 정책을 제어하는
  `.gitattributes` 변경은 전체 검증을 실행한다.
- backend 검증은 runner의 Gradle wrapper·dependency cache를 test
  container에 연결한다. Gradle test task 결과 cache는 사용하지 않아
  각 validation에서 test를 다시 실행한다.
- 두 ARM64 image 검증과 `main` publish는 `ubuntu-24.04-arm`에서
  실행하며 QEMU emulation을 사용하지 않는다.
- required image context 이름은 `API ARM64 image`, `Web ARM64 image`로
  Cubing Hub와 통일한다. 기존 `Backend ARM64 image`,
  `Frontend ARM64 image` protection context는 새 context가 exact PR head에서
  성공한 뒤 별도 설정 승인으로 전환한다.
- `main` branch protection이 PR의 다섯 validation check를 요구하므로
  `main` push에서는 같은 전체 검증을 다시 실행하지 않는다.
- `main` push에서만 두 ARM64 image를 GHCR에 같은 commit SHA로 발행한다.
- `main` 배포는 변경 경로와 무관하게 API·Web 동일 SHA image 두 개를
  발행하고 함께 교체하는 rollback 계약을 유지한다.
- 마지막 성공 Production deployment 이후 `.dockerignore`,
  `compose.production.yaml`, Cloudflare real-IP 설정,
  `runtime-config.Dockerfile` 또는 허용된 deploy·backup worker가 변경된
  배포만, 즉 runtime config가 변경된 배포만 immutable runtime-config
  image를 새로 발행하고 `update`한다.
  따라서 설정·worker 배포가 실패해도 다음 배포가 변경을 이어받는다.
  애플리케이션만 바뀌면 `keep`으로 현재 검증된 config digest와 worker를
  유지한다.
- 두 image 발행이 모두 끝나야 Tailscale OIDC와 제한된 SSH key로
  `home-mini`에 연결한다.
- forced command wrapper는 기존 v1과 전환용 v2의 정확한 형식만 허용한다.
  v2는 `deploy-guess-pokemon-v2 <40자리-sha> keep <registry-user>` 또는
  `deploy-guess-pokemon-v2 <40자리-sha> update <config-digest> <registry-user>`다.
- Mac mini deploy script는 GHCR token을 임시 Docker config에만 쓰고
  종료 시 정리한다.

배포 script는 Compose JSON의 최소 운영 보호 invariant 검증과 atomic
pointer 교체에 고정 system Python을 사용한다. stable bootstrap과 backup
worker도 script mode 검증에 같은 system Python을 사용한다. workflow 병합
전 Mac mini에서 아래 preflight를 통과해야 한다.

```bash
test -x /usr/bin/python3
/usr/bin/python3 --version
test -x /usr/local/bin/docker
/usr/local/bin/docker compose config --help \
  | /usr/bin/grep -q -- '--no-env-resolution'
```

`/usr/bin/python3`가 없거나 운영 Docker Compose가
`--no-env-resolution`을 지원하지 않으면 Homebrew Python이나 임의 PATH로
우회하지 말고 준비를 중단한다. Xcode Command Line Tools 또는 Docker
Compose 갱신 여부와 운영 영향은 별도 승인 후 확인한다.

v2 workflow를 `main`에 처음 병합하기 전에는 host 신뢰 경계를 담당하는
stable bootstrap 두 개만 사전 설치한다.

- `scripts/deploy-guess-pokemon-ci.sh` →
  `/Users/homeserver/Server/scripts/deploy/deploy-guess-pokemon-ci.sh`
- `scripts/backup-production-db-bootstrap.sh` →
  `/Users/homeserver/Server/scripts/backup/backup-guess-pokemon-bootstrap.sh`

기존 deploy bootstrap은 timestamp backup으로 보존하고, 두 설치본의
SHA-256과 repository 원본 일치, mode `700`, `/bin/bash -n`, 잘못된
forced command·argument 거부를 확인한 뒤에만 merge한다. 두 bootstrap은
같은 host FD lock을 사용하므로 deploy와 예약 backup이 동시에 Compose와
runtime state를 조작하지 않는다.

`scripts/deploy-guess-pokemon.sh`와 `scripts/backup-production-db.sh`는
stable bootstrap이 직접 덮어쓰는 host 파일이 아니다. 이 worker 두 개는
Compose와 Nginx 설정과 함께 exact runtime-config digest artifact에 mode
`700`으로 들어가며, `update`에서 project·revision label, entry allowlist,
regular-file·symlink·mode·Bash syntax와 content hash 검증을 통과한 immutable
release만 실행한다. 첫 성공 전에는 기존 host deploy·backup worker를
복구 fallback으로 보존한다. 새 worker가 없는 기존 두-file release는
읽기·복구 호환만 유지하고, 새 `update` candidate에는 두 worker를 반드시
요구한다.

배포 순서는 다음과 같다.

1. stable deploy bootstrap이 `update`일 때만 runtime-config image를 exact
   digest로 pull·추출하고 검증된 candidate deploy worker를 실행한다.
   `keep`은 현재 검증된 script-enabled release의 deploy worker만 실행한다.
2. worker가 두 SHA image를 pull한다. 배포 전 backup은 candidate release의
   검증된 backup worker를 사용하므로 첫 전환부터 host 고정 worker의
   수동 교체 없이 같은 artifact revision이 적용된다.
3. config revision, project label, 파일 allowlist와 production Compose의
   exact `db`·`api`·`web` service, `application`·`egress`·`edge` network,
   `postgres-data` volume 집합을 검증한다. DB는 승인된 named volume 하나만,
   API는 volume 없이, Web은 candidate release의 Nginx bind 하나만 사용한다.
   exact API·Web image와 network 경계를 확인하고 DB image·command·entrypoint·
   `POSTGRES_*`·`PGDATA`, API의 datasource·JPA·Flyway·Liquibase·SQL 초기화
   설정, Spring 외부 설정·JVM property override와 healthcheck `test` 명령은
   활성 Compose와 정확히 같게 유지한다. 각 service의 process user와 정규화한
   `tmpfs` mount target 집합도 활성 Compose 기준을 유지한다. API·Web image
   process override를 허용하지 않고 Web의 `edge` alias는
   `guess-pokemon-web` 하나만 허용한다. host
   port·privileged·추가 capability·device·Docker socket·host namespace·그 밖의 host bind와
   `volumes_from`·`configs`·`secrets`·`env_file`, `extra_hosts`·link 기반
   service discovery 우회를 금지한다. healthcheck timing, logging, restart,
   replica, resource limit과 일반 application 환경 변수의 정확값은 deploy
   script에 복제하지 않으며 repository review와 CI 검증 대상으로 둔다.
   `keep`은 현재 release 무결성만 확인한다.
4. DB가 실행 중인지 확인한다.
5. 진행 중 game이 1건 이상이면 60초마다 다시 확인하며 최대 15분간
   기다린다.
6. 15분 안에 진행 중 game이 0건이 되면 배포를 자동으로 이어가고,
   15분 시점에도 남아 있으면 기존 service를 바꾸지 않은 채 실패한다.
7. custom-format DB snapshot, manifest와 archive 검증을 완료한다.
8. runtime transaction의 `pending`을 기록한다.
9. candidate API image의 `MigrationMain`을 one-shot으로 실행해 Flyway
   migration과 validate를 완료한다. 일반 API container의 Flyway는 꺼 둔다.
10. API·Web image와 runtime config를 같은 transaction으로 적용한다.
11. 전체 service readiness와 API startup의 JPA schema validate를 확인한다.
12. public Web `/`, deep link `/history`, API readiness, 대표 Pokémon read
    endpoint와 현재 JavaScript asset을 확인한다.
13. 내부 health와 public smoke가 모두 성공한 경우에만 성공 state를 기록한다.
14. candidate health 또는 public smoke가 실패하면 이전 API·Web SHA와 runtime
    config를 함께 복구하고 public smoke를 다시 확인한다.

GitHub Actions의 deploy job 제한 시간은 30분이다. 이 시간에는 최대
15분의 game 종료 대기뿐 아니라 Tailscale 연결, image pull, backup,
최대 180초의 health check가 포함된다. 15분 대기 후 실패한 workflow는
game 종료 뒤 `Re-run jobs` → `Re-run failed jobs`로 같은 commit을 다시
배포할 수 있다.

image rollback은 PostgreSQL volume을 삭제하지 않는다. Flyway가 새
schema를 적용한 경우 DB migration은 자동으로 rollback하지 않는다.
migration 호환성 문제가 있으면 배포 전 backup과 별도 restore 계획을
사용한다.

One-shot migration은 candidate API/Web image pair를 subprocess의 Compose
interpolation에만 주입하고 `--pull never`로 이미 검증한 local image를 사용한다.
성공 전에는 production `.env`, state/current와 실행 중 API/Web을 바꾸지 않는다.

### 중단된 runtime config transaction 복구

v2 배포가 강제 종료되거나 host가 재시작되어
`/Users/homeserver/Server/apps/guess-pokemon/runtime-config/pending`이
남으면 후속 v2 배포는 fail closed한다. pending 파일을 직접 삭제하거나
수정하지 말고 Mac mini에서 다음 명령을 실행한다.

```bash
/Users/homeserver/Server/scripts/deploy/deploy-guess-pokemon.sh recover
```

recovery는 pending key와 SHA/digest 형식, 마지막 검증 state, release
allowlist와 content hash를 대조한다. 성공 state가 이미 target pair면
`.env`와 실행 service를 확인한 뒤 검증된 target release로 stale `current`
pointer를 원자 조정하고 marker를 정리하며,
state가 previous pair면 이전 API/Web SHA와 config release를
`--pull never`로 다시 적용한다. runtime config 도입 전 기존 설치는 legacy
Compose와 이전 SHA로 복구한다. 정상 image가 한 번도 없던 bootstrap 중단은
API/Web을 중지하고 zero-SHA placeholder로 되돌린다. pending/state가
불일치하거나 release가 변조됐으면 marker를 유지한 채 실패한다.
첫 성공 시 app directory에 별도 initialization marker를 원자 생성한다.
이 marker가 있는데 `state` 또는 `current`가 사라지면 pre-v2 설치로
fallback하지 않고 실패한다. marker가 생기기 전 실패한 bootstrap의
동일 digest candidate release는 다음 `update`에서 image와 다시 대조한
뒤 재사용할 수 있다.

복구 후 production Compose `ps`, DB/API/Web health, artwork egress와 public
Web/API/WebSocket을 다시 확인한다. Flyway migration은 recovery가 되돌리지
않는다.

## 14. 운영 snapshot, age/iCloud와 보존 계획

예약 작업은 stable
`/Users/homeserver/Server/scripts/backup/backup-guess-pokemon-bootstrap.sh`
만 호출한다. bootstrap은 deploy와 같은 FD lock을 획득한 뒤 verified
script-enabled release의 `scripts/backup-guess-pokemon.sh`를 실행한다.
전환 전에는 기존
`/Users/homeserver/Server/scripts/backup/backup-guess-pokemon.sh`를
legacy fallback으로 사용한다.
Stable bootstrap 설치만으로 macOS LaunchAgent가 등록되지는 않는다.
예약 실행을 사용할 때는 별도 승인된 LaunchAgent가 위 stable 경로만
호출하는지 확인한다. Repository template은
`launchd/com.homeserver.guess-pokemon-backup.plist.example`이며 Mac의 local
timezone이 Asia/Seoul인 전제에서 00:20, 06:20, 12:20, 18:20에 실행한다.

검증된 운영 DB archive와 backup 중 생성되는 임시 파일의 저장 위치는
`/Users/homeserver/Server/backups/guess-pokemon/data/`다. 프로젝트 backup
root의 `predeploy/`와 `bootstrap/`은 각각 배포 전 snapshot과 host bootstrap
설치본을 위한 별도 범주이며 DB retention 대상에 포함하지 않는다. 기존
`migration/` 자료도 자동 이동하거나 정리하지 않는다.

- 실행 중인 production DB만 대상으로 한다.
- runtime config v2 state가 있으면 state의 content hash와 `current` pointer가
  함께 가리키는 immutable release Compose만 사용한다. v2 state가 아직 없는
  기존 설치에서만 app directory의 legacy Compose를 사용한다.
- mode `700`의 temporary directory 안에 custom-format dump를 기록한다.
- `pg_restore --list`로 archive를 검증하고, DB에 연결하지 않은
  `pg_restore --data-only --schema=public --file=-`가 stdout에 생성한 COPY SQL
  stream에서 같은 archive
  snapshot의 public table row count를 계산한다. Engine/version과 dump
  SHA-256도 함께 기록한다.
- `--file=-` output contract나 COPY table coverage가 실패하면 `SUCCESS`와 manifest
  게시 전에 hard failure로 종료한다. Row count를 얻기 위해 live DB에 다시 연결하지 않는다.
- `manifest.json`을 만든 뒤 `SUCCESS`를 마지막으로 생성하고 같은 filesystem의
  `guess-pokemon-production-YYYYMMDDTHHMMSSZ/` directory로 원자 이동한다.
- 최근 정상 snapshot 4개와 지난 7 calendar day마다 KST 06:00 이후 첫 정상
  snapshot 1개를 보존 대상으로 계산한다.
- 결과는 `data/retention-plan.json`에 기록하며 현재 worker는 실제 삭제 없이
  dry-run만 수행한다.
- symlink, 불완전 snapshot, 예상 밖 이름과 다른 프로젝트 backup은 삭제
  후보에도 넣지 않는다.
- 이름이 일치하는 개별 snapshot의 metadata·dump·checksum을 권한 문제나 동시
  disappearance로 읽지 못하면 `invalidIgnored`에만 기록하고 `keep`과
  `pruneCandidates`에서 제외한다. Worker는 해당 snapshot을 수정하거나 삭제하지
  않는다.
- Backup root 열거와 retention plan 임시 파일 생성·flush·원자 교체 실패는
  fail-closed로 전체 backup을 실패시킨다.

같은 Mac mini SSD의 backup은 장비 전체 장애를 복구하지 못한다.
검증된 snapshot만 age public recipient로 암호화해 local offsite staging에
기록하고 iCloud Drive의 Guess Pokémon 전용 directory로 전달한다. raw dump는
iCloud에 복사하지 않는다. `.partial` 복사본의 SHA-256 일치, final rename 성공,
symlink가 아닌 final regular file과 local ciphertext의 SHA-256 재일치까지 확인한
뒤에만 handoff 성공과 iCloud-stage heartbeat를 허용한다. Final 검증 전 실패하면
local ciphertext를 보존한다. 검증된 final 뒤 local ciphertext 정리만 실패하면
generic 경고를 남기고 handoff 성공은 유지한다. 이 handoff는 Apple server remote
upload 완료 판정과는 다르다.

선택적 mode `0600` `backup-heartbeats.conf`는
`LOCAL_HEARTBEAT_URL`, `ICLOUD_STAGE_HEARTBEAT_URL` 두 key만 허용한다. URL은
Git·문서·로그에 남기지 않는다. 최초 7일 관찰, remote decrypt·restore drill과
별도 backup 삭제 승인 전에는 `retention-plan.json`의 `pruneCandidates`를
실행하지 않는다. 전체 계약은
`docs/DEVELOPMENT-DEPLOYMENT-BACKUP.md`를 따른다.

## 15. 참고 문서

- [Cloudflare Tunnel 설정](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- [Cloudflare HTTP 요청 header](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
- [Docker Compose profile](https://docs.docker.com/compose/how-tos/profiles/)
- [Docker Compose secret](https://docs.docker.com/compose/how-tos/use-secrets/)
- [PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)
- [PostgreSQL pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html)
