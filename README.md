# Guess Pokémon

친구와 질문을 주고받으며 스무 번 안에 정답 포켓몬을 찾아내는 실시간 1:1 웹 게임입니다.

한 명은 전국도감에서 정답 포켓몬을 고르고, 다른 한 명은 자유롭게 질문하거나 포켓몬을 추측합니다. 한 경기가 끝나면 역할을 바꿔 재대결할 수 있습니다.

## 어떤 게임인가요?

1. 두 사용자가 회원가입하고 같은 방에 입장합니다.
2. 첫 경기에서는 방장이 출제자가 되어 정답 포켓몬을 고릅니다.
3. 질문자는 포켓몬의 특징을 질문하거나 전국도감에서 정답을 추측합니다.
4. 출제자는 `예`, `아니요`, `모르겠어요`로 답하고 필요한 경우 코멘트를 덧붙입니다.
5. 질문과 추측을 합쳐 20번 안에 정답을 맞히면 질문자가 승리합니다.
6. 재대결에 동의하면 출제자와 질문자 역할을 바꿔 다음 경기를 시작합니다.

## 주요 기능

| 영역 | 제공 기능 |
|---|---|
| 실시간 대전 | WebSocket/STOMP 기반 1:1 질문·답변·추측 동기화 |
| 방 찾기 | 6자리 방 코드 입장과 참가 가능한 방·방장 닉네임 조회 |
| 전국도감 | 1~1,025번 기본 포켓몬의 한국어 이름, 세대, 타입, 공식 일러스트 |
| 게임 규칙 | 질문·추측 합산 20회, 오답 차감, 역할별 정답 정보 분리 |
| 연결 복구 | 일시적인 연결 종료 시 60초 재접속 대기 후 승패 처리 |
| 재대결 | 두 참가자가 동의하면 역할을 바꿔 다음 경기 진행 |
| 경기 기록 | 참가자, 역할, 정답, 승패, 종료 사유, 질문·답변·코멘트·추측 조회 |
| 화면 이동 | React Router 기반 SPA route, 직접 URL 접근과 브라우저 뒤로가기 |
| 반응형 UI | 데스크톱과 모바일에서 같은 게임 흐름 제공 |

## 기술 스택

| 영역 | 기술 |
|---|---|
| Frontend | React, TypeScript, Vite, React Router, Lucide React |
| Backend | Spring Boot, Java 21, Gradle |
| Database | PostgreSQL, Flyway, Spring Data JPA, Spring Session JDBC |
| Realtime | WebSocket, STOMP |
| Security | Spring Security, cookie session, CSRF |
| Infrastructure | Docker Compose, Nginx, Cloudflare Tunnel |
| Test | JUnit, Spring Test, Testcontainers, Vitest, Testing Library, Playwright |

브라우저 요청은 Nginx를 거쳐 React SPA와 Spring Boot API로 전달됩니다. 완료된 경기와 회원 정보는 PostgreSQL에 저장하고, 진행 중인 방과 재접속 타이머는 단일 API 인스턴스의 메모리에서 관리합니다.

## 로컬에서 실행하기

호스트에는 Docker Desktop과 Git만 필요합니다. Java, Node.js, PostgreSQL은 별도로 설치하지 않습니다.

```bash
git clone https://github.com/xxh3898/guess-pokemon.git
cd guess-pokemon
cp .env.example .env
docker compose --env-file .env up --build
```

실행하기 전에 `.env`의 `POSTGRES_PASSWORD`를 로컬 개발용 값으로 변경하세요. 컨테이너가 준비되면 [http://localhost:8080](http://localhost:8080)에서 접속할 수 있습니다.

처음 접속했다면 회원가입 후 로그인하세요. 로비에서 새 방을 만들거나 참가 가능한 방을 선택할 수 있으며, 다른 사용자에게 6자리 방 코드를 전달해 입장시킬 수도 있습니다.

개발 환경, 데이터베이스 관리, 외부 공개, 백업과 복구 방법은 [운영 가이드](docs/OPERATIONS.md)를 참고하세요.

## 프로젝트 구조

```text
guess-pokemon/
├── frontend/          # React SPA
├── backend/           # Spring Boot API·실시간 게임 서버
├── infra/             # Nginx와 외부 공개 설정
├── scripts/           # 전국도감·백업·구성 검증 도구
├── docs/              # 요구사항과 기술 명세
├── compose.yaml       # 기본 실행 환경
├── compose.dev.yaml   # 개발 환경
├── compose.test.yaml  # 격리 테스트 환경
└── compose.tunnel.yaml
```

## 테스트

모든 검증은 Docker 환경에서 실행합니다.

```bash
# Frontend lint, typecheck, test, build
docker compose -f compose.test.yaml run --rm frontend-test

# Backend unit·integration test
docker compose -f compose.test.yaml run --rm backend-test

# Nginx·운영 구성 검증
docker compose -f compose.test.yaml run --rm infra-test
docker compose -f compose.test.yaml run --rm nginx-config-test
```

백엔드 통합 테스트는 Testcontainers로 격리된 PostgreSQL을 사용합니다.

## 문서

- [서비스 요구사항](docs/PRD.md)
- [아키텍처](docs/ARCHITECTURE.md)
- [ERD](docs/ERD.md)
- [REST·STOMP API 명세](docs/API.md)
- [운영 가이드](docs/OPERATIONS.md)

## 현재 범위

현재 버전은 단일 서버에서 지인과 소규모로 즐기는 환경을 기준으로 합니다. 이메일 인증, 비밀번호 찾기, 소셜 로그인, 익명 플레이, 자동 매칭, 랭킹, 관전자와 다중 API 인스턴스 간 방 공유는 아직 제공하지 않습니다.

## 권리 고지

Guess Pokémon은 비공식 비상업 팬 프로젝트이며 Pokémon 공식 서비스와 제휴하거나 후원받지 않습니다. Pokémon 및 관련 이름과 이미지는 각 권리자의 자산입니다. 비상업 운영과 비공식 표시는 사용 허가를 대신하지 않습니다.
