# AGENTS.md

## 프로젝트

Guess Pokémon은 두 명이 실시간으로 포켓몬 스무고개를 진행하는 웹 서비스다.

- 프런트엔드: React SPA, TypeScript, React Router
- 백엔드: Spring Boot, Java 21, Gradle
- 데이터베이스: PostgreSQL
- 실시간 통신: WebSocket/STOMP
- 실행 환경: Docker Compose

서비스·기술 명세는 `docs/` 아래 공식 문서를 source of truth로 사용한다.

## 개발 원칙

- 의미 있는 변경은 조사, 계획, 사용자 승인, 구현, 검증 순서로 진행한다.
- 한 번에 하나의 승인된 commit 단위만 구현한다.
- 요청 범위를 넘어선 기능이나 추상화를 미리 추가하지 않는다.
- 호스트에 Java, Node.js, PostgreSQL을 설치하지 않고 Docker 기반 명령을 사용한다.
- 비밀번호, token, 실제 DB 접속 정보, tunnel credential을 코드나 문서에 넣지 않는다.
- `.env.example`에는 이름과 로컬 예시만 두고 실제 secret은 Git 밖에서 관리한다.

## 문서 동기화

- 서비스 범위를 바꾸면 `docs/PRD.md`를 함께 수정한다.
- component 경계, 상태 소유권, 배포 구조를 바꾸면 `docs/ARCHITECTURE.md`를 함께 수정한다.
- table, column, 제약, migration을 바꾸면 `docs/ERD.md`를 함께 수정한다.
- REST·STOMP 공개 계약을 바꾸면 `docs/API.md`를 코드와 같은 변경 단위에서 수정한다.
- `/Users/chiho/AI/**` 작업 산출물은 공식 프로젝트 문서가 아니며 repository에 복사하지 않는다.

## 코드 구조

- `frontend/`: React SPA
- `backend/`: Spring Boot API와 실시간 game server
- `infra/`: reverse proxy와 tunnel 설정
- `scripts/`: catalog, backup, 검증 도구
- `docs/`: 공식 서비스·기술 문서

새 구조는 실제 책임이 생길 때만 추가한다.

## 프런트엔드 UI 구현과 완료 기준

- 프런트엔드 화면 작업을 시작하기 전에 `ui시안/README.md`와 대상 화면 PNG를 반드시 확인한다.
- 화면 구조, 정보 우선순위, 색상, 반응형 구성은 `ui시안/`을 구현 기준으로 삼는다.
- 문구, 기능, 게임 규칙, API 계약은 `docs/`, 코드, 테스트를 source of truth로 사용한다. 시안과 충돌하면 임의로 판단하지 말고 먼저 보고한다.
- 모든 사용자 화면은 PC와 모바일을 함께 구현한다. 한쪽만 구현한 상태는 완료로 간주하지 않는다.
- 최소한 PC `1440px` 너비와 모바일 `390px` 너비에서 실제 브라우저 또는 브라우저 자동화로 검증한다.
- 변경 범위의 route, 주요 상호작용, modal, 글자·이미지 잘림, 가로 스크롤, 반응형 재배치를 PC와 모바일에서 각각 확인한다.
- 관련 test, typecheck, lint, build 통과만으로 완료하지 않는다. PC·모바일 화면 검증 결과까지 확인하고 보고해야 성공으로 간주한다.
- PC와 모바일 중 하나라도 검증하지 못했거나 문제가 남아 있으면 완료로 보고하지 않는다.

## 테스트

- 신규 기능과 production class에는 관련 테스트를 같은 변경 단위에 추가한다.
- 테스트 메서드는 `should_{expectedBehavior}_when_{condition}` 형식을 사용한다.
- 단위 테스트는 `{TargetClass}Test`, 통합 테스트는 `{TargetClass}IntegrationTest` 형식을 사용한다.
- 정상, 실패, 권한, validation, 예외 경계를 구분해 검증한다.
- 문서만 바꾸는 작업은 링크, 예시 JSON, 용어, 공백 오류를 검증한다.

## Git

- 커밋 메시지는 영어 type prefix와 한글 제목·본문을 사용한다.
- 커밋 전 변경 파일, diff, 검증 결과를 확인하고 사용자 승인을 받는다.
- build 결과, IDE 설정, secret, backup, 테스트 보고서는 commit하지 않는다.
- 공식 `docs/**`와 `.env.example`은 추적한다.
