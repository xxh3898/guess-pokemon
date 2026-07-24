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

- React, TypeScript, Vite, React Router
- Spring Boot, Java 21, Gradle
- PostgreSQL, Flyway
- WebSocket/STOMP
- Docker Compose, Nginx, Cloudflare Tunnel

호스트에 Java, Node.js, PostgreSQL을 직접 설치하지 않고 Docker 환경에서 개발하고 검증합니다.

## 문서

- [서비스 요구사항](docs/PRD.md)
- [아키텍처](docs/ARCHITECTURE.md)
- [ERD](docs/ERD.md)
- [REST·STOMP API 명세](docs/API.md)

현재는 공식 계약 문서를 확정하는 첫 개발 단계입니다. 실행 명령은 애플리케이션 scaffold와 Docker 구성을 추가한 뒤 이 문서에 안내합니다.

## 공개 운영 주의

이 프로젝트는 비공식 비상업 팬 프로젝트이며 Pokémon 및 관련 이름과 이미지는 각 권리자의 자산입니다. 비상업 운영과 비공식 표시는 사용 허가를 대신하지 않으므로 공개 배포 전에 권리 범위를 별도로 검토해야 합니다.
