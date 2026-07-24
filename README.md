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

## Docker 검증

프런트엔드 전체 검증은 다음 명령으로 실행합니다.

```bash
docker compose -f compose.test.yaml run --rm frontend-test
```

백엔드 통합 테스트는 Testcontainers가 격리된 PostgreSQL 18.4 컨테이너를 실행합니다. Docker Desktop의 daemon socket을 테스트 컨테이너에 제공하므로 신뢰할 수 있는 로컬 소스에서만 실행합니다.

```bash
docker compose -f compose.test.yaml run --rm backend-test
```

서비스를 종료할 때는 PostgreSQL named volume을 보존합니다.

```bash
docker compose --env-file .env down
```

`docker compose down -v`는 PostgreSQL 데이터를 제거하므로 별도 백업과 명시적 판단 없이 실행하지 않습니다.

## 문서

- [서비스 요구사항](docs/PRD.md)
- [아키텍처](docs/ARCHITECTURE.md)
- [ERD](docs/ERD.md)
- [REST·STOMP API 명세](docs/API.md)

현재는 TypeScript 7.0.2 기반 React SPA, Spring Boot, PostgreSQL 18.4를 Docker Compose로 실행할 수 있습니다. 애플리케이션 테이블과 회원가입 기능은 이후 작업 단위에서 Flyway migration과 함께 추가합니다.

## 공개 운영 주의

이 프로젝트는 비공식 비상업 팬 프로젝트이며 Pokémon 및 관련 이름과 이미지는 각 권리자의 자산입니다. 비상업 운영과 비공식 표시는 사용 허가를 대신하지 않으므로 공개 배포 전에 권리 범위를 별도로 검토해야 합니다.
