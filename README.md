# Guess Pokémon

두 명이 방 코드를 공유해 실시간으로 즐기는 포켓몬 스무고개 웹 서비스입니다. 첫 경기에서는 방장이 정답 포켓몬을 고르고, 상대방이 질문과 추측을 진행합니다. 재대결에서는 역할을 번갈아 맡습니다.

## 주요 범위

- 로그인 ID, 비밀번호, 닉네임 기반 회원가입과 로그인
- 전국도감 1~9세대 기본 포켓몬 종
- 질문, 답변, 포켓몬 추측을 합쳐 최대 20회
- WebSocket/STOMP 기반 실시간 1:1 게임
- 60초 재접속 대기 후 이탈 패배
- 참가자, 역할, 정답, 승패, 종료 사유, 질문·답변·추측 기록 저장
- React Router 기반 SPA route와 브라우저 뒤로가기

## 기술 구성

- React, TypeScript, Vite, React Router, Lucide React
- Spring Boot, Java 21, Gradle
- PostgreSQL, Flyway
- WebSocket/STOMP
- Docker Compose, Nginx, Cloudflare Tunnel

호스트에 Java, Node.js, PostgreSQL을 직접 설치하지 않고 Docker 환경에서 개발하고 검증합니다.

## Docker 실행

호스트에는 Docker Desktop만 필요합니다. 로컬 실행용 환경 파일을 만들고 예시 비밀번호를 개발 전용 값으로 바꿉니다.

```bash
cp .env.example .env
docker compose --env-file .env up --build
```

production-like 환경은 `http://localhost:8080`에서 Nginx를 통해 SPA와 API health endpoint를 제공합니다.

소스 변경을 즉시 반영하는 개발 환경은 다음과 같이 실행합니다.

```bash
docker compose --env-file .env \
  -f compose.yaml \
  -f compose.dev.yaml \
  up --build
```

개발 환경의 Vite 주소는 `http://localhost:5173`입니다. 해당 포트를 이미 사용 중이면 `.env`의 `FRONTEND_DEV_PORT`를 바꿀 수 있습니다. Vite는 `/api`와 `/ws`를 내부 API 컨테이너로 전달합니다.

브라우저에서 `/signup`으로 계정을 만든 뒤 `/login`에서 로그인합니다. 회원가입은 자동 로그인하지 않으며 로그인에 성공하면 보호 route인 `/lobby`로 이동합니다. 보호 route를 직접 열었다면 로그인 뒤 원래 주소로 돌아갑니다.

개발 환경에서는 Adminer를 `http://127.0.0.1:8081`에서 함께 제공합니다. 포트가 겹치면 `.env`의 `ADMINER_PORT`를 바꿉니다. 로그인 화면에서는 system으로 `PostgreSQL`, server로 `db`를 선택하고 database, username, password에는 `.env`의 `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` 값을 각각 입력합니다. Adminer는 개발 환경에만 포함되며, 화면에서 실행한 SQL은 개발 DB 데이터를 변경할 수 있습니다.

개발 환경을 종료할 때도 Adminer가 별도 container로 남지 않도록 실행할 때와 같은 Compose 파일을 지정합니다.

```bash
docker compose --env-file .env \
  -f compose.yaml \
  -f compose.dev.yaml \
  down
```

## 전국도감 snapshot

전국도감 snapshot 생성기는 PokéAPI 응답을 local cache에 저장하고 1~1,025번 기본 포켓몬의 한국어 이름, 세대, official artwork를 검증합니다. runtime과 일반 test는 PokéAPI를 호출하지 않습니다.

```bash
docker run --rm \
  -v "$PWD:/workspace" \
  -w /workspace \
  node:24.18.0-alpine3.24 \
  node --test scripts/fetch-pokemon-catalog.test.mjs

docker run --rm \
  -v "$PWD:/workspace" \
  -w /workspace \
  node:24.18.0-alpine3.24 \
  node scripts/fetch-pokemon-catalog.mjs
```

PokéAPI species 수가 1,025와 달라지거나 필수 한국어 이름·artwork가 빠지면 생성기는 기존 snapshot을 교체하지 않고 실패합니다. 새 포켓몬 반영은 PRD와 catalog 검증 범위를 먼저 갱신한 별도 commit으로 진행합니다.

## Docker 검증

프런트엔드 전체 검증은 다음 명령으로 실행합니다.

```bash
docker compose -f compose.test.yaml run --rm frontend-test
```

백엔드 통합 테스트는 Testcontainers가 격리된 PostgreSQL 18.4 컨테이너를 실행합니다. Docker Desktop의 daemon socket을 테스트 컨테이너에 제공하므로 신뢰할 수 있는 로컬 소스에서만 실행합니다.

```bash
docker compose -f compose.test.yaml run --rm backend-test
```

Nginx WebSocket 프록시 설정 검증은 다음 명령으로 실행합니다.

```bash
docker compose -f compose.test.yaml run --rm infra-test
docker compose -f compose.test.yaml run --rm nginx-config-test
```

서비스를 종료할 때는 PostgreSQL named volume을 보존합니다.

```bash
docker compose --env-file .env down
```

`docker compose down -v`는 PostgreSQL 데이터를 제거하므로 별도 백업과 명시적 판단 없이 실행하지 않습니다.

## 외부 통합 테스트와 운영

`compose.tunnel.yaml`은 기존 Compose에 Cloudflare Quick Tunnel·named tunnel profile을 추가합니다. Quick Tunnel은 격리된 임시 DB에서만 사용하고, named tunnel token은 Git에서 제외한 file secret으로 전달합니다. Tunnel 구성은 origin port를 loopback으로 제한하고 운영 session cookie의 `Secure` 값을 강제합니다.

service를 시작하지 않고 base·dev·Tunnel 병합 결과를 먼저 확인할 수 있습니다.

```bash
ENV_FILE=.env ./scripts/verify-compose.sh
```

Quick Tunnel은 무작위 공개 URL을 만들고 named tunnel은 실제 Cloudflare 계정·domain route를 사용하므로 실행 전에 대상 환경과 데이터 경계를 확인해야 합니다. 실행, backup, restore rehearsal, rollback 절차는 [운영 가이드](docs/OPERATIONS.md)를 따릅니다.

PostgreSQL custom-format backup은 실행 중인 DB container의 도구로 생성하고 archive 목록을 확인합니다.

```bash
ENV_FILE=.env ./scripts/backup-db.sh
```

## 문서

- [서비스 요구사항](docs/PRD.md)
- [아키텍처](docs/ARCHITECTURE.md)
- [ERD](docs/ERD.md)
- [REST·STOMP API 명세](docs/API.md)
- [운영 가이드](docs/OPERATIONS.md)

현재는 TypeScript 7.0.2 기반 React SPA와 Spring Boot, PostgreSQL 18.4를 Docker Compose로 실행할 수 있습니다. 프런트엔드는 회원가입·로그인·로그아웃, cookie session 복원, CSRF 공통 client, 비회원·회원 route guard, 방 생성·코드 입장·이어하기와 실시간 대기방을 제공합니다. 대기방은 `@stomp/stompjs`로 사용자별 queue를 구독하고 `resume` snapshot, 연결 상태, 명시적 이탈과 방 종료를 동기화합니다. 백엔드는 Flyway 기반 회원·Spring Session·전국도감·경기 기록 schema와 포켓몬 검색, 2인 방 REST API를 제공합니다. `/ws` STOMP 연결에는 session 인증과 CSRF를 적용했으며 정답 선택, 질문, 답변, 추측, 60초 재접속, 이탈 종료, 역할을 바꾸는 재대결을 사용자별 event로 처리합니다. 포켓몬 선택·실제 경기·기록 프런트엔드 화면은 후속 작업 단위에서 연결합니다.

## 공개 운영 주의

이 프로젝트는 비공식 비상업 팬 프로젝트이며 Pokémon 및 관련 이름과 이미지는 각 권리자의 자산입니다. 비상업 운영과 비공식 표시는 사용 허가를 대신하지 않으므로 공개 배포 전에 권리 범위를 별도로 검토해야 합니다.
