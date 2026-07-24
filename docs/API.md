# Guess Pokémon REST·STOMP API 명세

- 작성일: 2026-07-24
- REST base path: `/api/v1`
- WebSocket endpoint: `/ws`
- 상태: 공식 계약 기준선

## 1. 공통 원칙

- JSON field는 `camelCase`를 사용한다.
- ID는 UUID string, 포켓몬 ID는 National Dex integer다.
- 시각은 UTC RFC 3339 형식으로 반환한다.
- 인증은 같은 출처의 server-side session cookie를 사용한다.
- state-changing REST 요청과 STOMP `CONNECT`는 CSRF token을 요구한다.
- 클라이언트가 보낸 `userId`, role, action count, win/lose 결과는 신뢰하지 않는다.
- questioner 응답과 event에는 경기 종료 전 정답 포켓몬을 절대 포함하지 않는다.
- 내부 예외, SQL, stack trace, session ID는 응답에 넣지 않는다.

## 2. 공통 HTTP header

### 요청

```http
Content-Type: application/json
Accept: application/json
X-XSRF-TOKEN: <csrf-token>
```

`GET`, `HEAD`, `OPTIONS`를 제외한 요청은 CSRF header를 보낸다.

### 응답

```http
Content-Type: application/json
Cache-Control: no-store
```

인증·방·게임 기록 응답에는 `no-store`를 적용한다. 포켓몬 catalog 목록은 짧은 private cache 또는 ETag를 사용할 수 있다.

인증 요청 제한 응답에는 보수적인 재시도 대기값으로 다음 header를 추가한다.

```http
Retry-After: 600
```

## 3. 오류 형식

Spring `ProblemDetail` 기반 `application/problem+json`을 사용한다.

```json
{
  "type": "about:blank",
  "title": "방 입장 실패",
  "status": 409,
  "detail": "이미 다른 활성 방에 참여하고 있습니다.",
  "instance": "/api/v1/rooms/AB3K7M/join",
  "code": "USER_ALREADY_IN_ACTIVE_ROOM",
  "traceId": "2de3f9a1"
}
```

- `detail`은 사용자에게 보여줄 수 있는 안전한 한국어 문장이다.
- `code`는 프런트엔드 분기용 안정 식별자다.
- `traceId`는 민감정보가 아닌 짧은 server correlation ID다.
- 정의하지 않은 API 경로는 `404 RESOURCE_NOT_FOUND`를 반환한다.

공통 status:

| Status | 의미 |
|---:|---|
| 400 | JSON·validation·상태 입력 오류 |
| 401 | 로그인 필요 또는 session 만료 |
| 403 | 로그인했지만 대상 권한 없음 또는 CSRF 실패 |
| 404 | 존재하지 않거나 조회자에게 숨겨야 하는 resource |
| 409 | 중복·현재 상태와 충돌 |
| 410 | 만료된 방 |
| 429 | 요청 횟수 제한 |
| 500 | 안전하게 가린 서버 오류 |
| 503 | DB·필수 catalog 등 서비스 준비 실패 |

## 4. 공통 resource

### `UserSummary`

```json
{
  "id": "624f7d62-e328-4ff0-8b90-f6520b81a47f",
  "loginId": "trainer_red",
  "nickname": "레드"
}
```

다른 사용자에게는 `id`, `nickname`만 반환하고 `loginId`는 반환하지 않는다.

### `PokemonSummary`

```json
{
  "nationalDexId": 25,
  "koreanName": "피카츄",
  "generation": 1,
  "artworkUrl": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",
  "artworkEnabled": true
}
```

`artworkEnabled=false`이면 `artworkUrl`은 null이다.

### `Page`

```json
{
  "content": [],
  "page": 0,
  "size": 20,
  "totalElements": 1025,
  "totalPages": 52
}
```

`size` 기본값은 20, 최대값은 100이다.

## 5. 인증 REST API

### 5.1 CSRF token

`GET /api/v1/auth/csrf`

접근: 모두

응답 `200`:

```json
{
  "headerName": "X-XSRF-TOKEN",
  "parameterName": "_csrf",
  "token": "masked-token"
}
```

token 값은 log에 남기지 않는다.

### 5.2 회원가입

`POST /api/v1/auth/signup`

접근: 비회원

요청:

```json
{
  "loginId": "trainer_red",
  "password": "user-supplied-password",
  "nickname": "레드"
}
```

validation:

- `loginId`: trim·lowercase 정규화 뒤 4~30자, 영문 소문자·숫자·underscore
- `password`: UTF-8 기준 8~72 byte
- `nickname`: trim·NFC 뒤 2~16자, 제어문자·format 문자·`<`·`>` 금지

응답 `201`:

```json
{
  "user": {
    "id": "624f7d62-e328-4ff0-8b90-f6520b81a47f",
    "loginId": "trainer_red",
    "nickname": "레드"
  }
}
```

오류:

- `400 VALIDATION_FAILED`
- `403 ACCESS_DENIED` (이미 로그인한 회원)
- `409 LOGIN_ID_ALREADY_EXISTS`
- `409 NICKNAME_ALREADY_EXISTS`
- `429 SIGNUP_RATE_LIMITED`

중복 응답은 login ID와 nickname 중 어떤 항목인지 사용자 본인 입력 검증 범위에서 알려준다.
같은 client IP에서 10분 동안 signup 요청 5개를 처리하고 여섯 번째 요청부터 제한한다.

### 5.3 로그인

`POST /api/v1/auth/login`

접근: 비회원

요청:

```json
{
  "loginId": "trainer_red",
  "password": "user-supplied-password"
}
```

`loginId`는 회원가입과 같은 방식으로 정규화한다. 형식이 올바르지 않아도 계정 존재 여부를 드러내지 않고 `INVALID_CREDENTIALS`를 반환한다.

응답 `200`:

```json
{
  "user": {
    "id": "624f7d62-e328-4ff0-8b90-f6520b81a47f",
    "loginId": "trainer_red",
    "nickname": "레드"
  }
}
```

오류:

- `400 VALIDATION_FAILED`
- `401 INVALID_CREDENTIALS`
- `403 ACCESS_DENIED` (이미 로그인한 회원)
- `403 USER_DISABLED`
- `429 LOGIN_RATE_LIMITED`

존재하지 않는 login ID와 잘못된 password는 같은 `INVALID_CREDENTIALS` 응답과 유사한 처리 시간을 사용한다.
login ID별 비밀번호 실패는 10분 동안 5개를 처리하고 여섯 번째 요청부터 제한한다. 제한에 도달하기 전에 성공하면 해당 ID의 실패 횟수를 초기화한다.
같은 client IP의 전체 login 요청은 성공 여부와 관계없이 10분 동안 30개를 처리하고 서른한 번째 요청부터 제한한다.

### 5.4 로그아웃

`POST /api/v1/auth/logout`

접근: 회원

응답: `204`

활성 경기 중이면 `409 ACTIVE_GAME_MUST_BE_LEFT_FIRST`를 반환한다. 사용자는 경기 화면의 명시적 나가기를 먼저 실행해야 한다.

### 5.5 현재 사용자

`GET /api/v1/auth/me`

접근: 회원

응답 `200`:

```json
{
  "user": {
    "id": "624f7d62-e328-4ff0-8b90-f6520b81a47f",
    "loginId": "trainer_red",
    "nickname": "레드"
  },
  "activeRoomCode": "AB3K7M"
}
```

비회원: `401 AUTHENTICATION_REQUIRED`

활성 방이 없으면 `activeRoomCode`는 `null`이다. 방 생성·입장 뒤에는 해당 code를 반환하며, 명시적 나가기나 방 만료로 membership을 해제하면 다시 `null`을 반환한다.

## 6. 포켓몬 REST API

### 6.1 목록·검색

`GET /api/v1/pokemon-species`

접근: 회원

query:

| 이름 | Type | 기본값 | 설명 |
|---|---|---:|---|
| `query` | string | 빈 값 | 한국어 이름 또는 도감 번호 |
| `generation` | integer | 전체 | 1~9 |
| `page` | integer | 0 | 0 이상 |
| `size` | integer | 20 | 1~100 |

`query`는 trim 뒤 최대 80자다. 숫자만 입력하면 National Dex 번호 exact match로, 그 외에는 NFC 정규화한 한국어 이름 부분 일치로 검색한다. 빈 값은 전체 목록을 뜻한다. 결과는 `nationalDexId` 오름차순으로 고정하며 client가 임의 sort를 지정할 수 없다.

응답 `200`:

```json
{
  "content": [
    {
      "nationalDexId": 25,
      "koreanName": "피카츄",
      "generation": 1,
      "artworkUrl": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",
      "artworkEnabled": true
    }
  ],
  "page": 0,
  "size": 20,
  "totalElements": 1,
  "totalPages": 1
}
```

오류:

- `400 VALIDATION_FAILED`
- `401 AUTHENTICATION_REQUIRED`

### 6.2 단건

`GET /api/v1/pokemon-species/{nationalDexId}`

접근: 회원

응답: `200 PokemonSummary`

오류:

- `400 VALIDATION_FAILED`
- `401 AUTHENTICATION_REQUIRED`
- `404 POKEMON_NOT_FOUND`

## 7. 방 REST API

### `RoomSnapshot`

방 생성 직후 방장용 예:

```json
{
  "roomCode": "AB3K7M",
  "status": "WAITING_FOR_OPPONENT",
  "stateVersion": 1,
  "roundNumber": 1,
  "me": {
    "userId": "70226fe2-cdee-4261-a3cb-fbd87a4df783",
    "nickname": "그린",
    "role": "SELECTOR",
    "connected": true
  },
  "opponent": null,
  "game": null
}
```

질문자용 예:

```json
{
  "roomCode": "AB3K7M",
  "status": "WAITING_FOR_SELECTION",
  "stateVersion": 3,
  "roundNumber": 1,
  "me": {
    "userId": "624f7d62-e328-4ff0-8b90-f6520b81a47f",
    "nickname": "레드",
    "role": "QUESTIONER",
    "connected": true
  },
  "opponent": {
    "userId": "70226fe2-cdee-4261-a3cb-fbd87a4df783",
    "nickname": "그린",
    "role": "SELECTOR",
    "connected": true
  },
  "game": null
}
```

첫 round는 방장이 `SELECTOR`, 입장한 사용자가 `QUESTIONER`다. 생성 직후 status는 `WAITING_FOR_OPPONENT`이고 입장 뒤 `WAITING_FOR_SELECTION`로 바뀐다. `stateVersion`은 1부터 시작하고 membership이나 status가 바뀔 때 증가한다. `roundNumber`는 1부터 시작한다.

이번 REST 방 단계의 `connected=true`는 create·join 요청을 성공한 활성 participant라는 뜻이다. 실제 STOMP session 연결 상태는 실시간 통신 구현에서 같은 field에 연결한다.

출제자용 snapshot은 본인에게만 다음 field를 추가할 수 있다.

```json
{
  "selectedPokemon": {
    "nationalDexId": 25,
    "koreanName": "피카츄",
    "generation": 1,
    "artworkUrl": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",
    "artworkEnabled": true
  }
}
```

질문자 DTO type에는 `selectedPokemon` field 자체를 두지 않는다.

### 7.1 방 생성

`POST /api/v1/rooms`

접근: 회원

요청 body: 없음

응답 `201`: 방장용 `RoomSnapshot`

오류:

- `409 USER_ALREADY_IN_ACTIVE_ROOM`
- `503 ROOM_CAPACITY_UNAVAILABLE`

활성 방은 단일 API instance에서 최대 1,000개다. 새 code를 100회 안에 할당하지 못한 경우에도 `ROOM_CAPACITY_UNAVAILABLE`을 반환한다.

### 7.2 방 입장

`POST /api/v1/rooms/{roomCode}/join`

접근: 회원

응답 `200`: 참가자용 `RoomSnapshot`

`roomCode`는 앞뒤 공백을 제거하고 대문자로 정규화한다. 허용 문자는 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`이며 길이는 6자다.

오류:

- `400 VALIDATION_FAILED`
- `404 ROOM_NOT_FOUND`
- `410 ROOM_EXPIRED`
- `409 ROOM_FULL`
- `409 CANNOT_JOIN_OWN_ROOM`
- `409 USER_ALREADY_IN_ACTIVE_ROOM`

방장만 있는 방은 최초 생성 30분 뒤 만료한다. 만료 code는 30분 동안 `ROOM_EXPIRED`로 구분한 뒤 `ROOM_NOT_FOUND`로 수렴한다.

### 7.3 방 상태

`GET /api/v1/rooms/{roomCode}`

접근: 해당 방 참가자

응답 `200`: 역할별 `RoomSnapshot`

오류:

- `400 VALIDATION_FAILED`
- `403 ROOM_MEMBERSHIP_REQUIRED`
- `404 ROOM_NOT_FOUND`

새로고침과 STOMP reconnect 뒤 state 복구에 사용한다.

### 7.4 명시적 나가기

`DELETE /api/v1/rooms/{roomCode}/members/me`

접근: 해당 방 참가자

응답: `204`

- 대기 중 방장이 나가면 방을 닫고 두 참가자의 활성 방을 해제한다.
- 대기 중 참가자가 나가면 방장만 남은 `WAITING_FOR_OPPONENT` 상태로 돌아간다.
- 진행 중이면 즉시 `PLAYER_LEFT` 기권 패배를 확정한다.
- 네트워크 단절과 달리 60초 유예를 적용하지 않는다.

오류:

- `400 VALIDATION_FAILED`
- `403 ROOM_MEMBERSHIP_REQUIRED`
- `404 ROOM_NOT_FOUND`

이번 방 생성·입장 단계는 대기 상태 나가기만 처리한다. 진행 중 기권과 경기 종료 기록은 game 구현에서 같은 endpoint에 연결한다.

## 8. 경기 기록 REST API

### 8.1 내 경기 목록

`GET /api/v1/games`

접근: 회원

query:

| 이름 | Type | 기본값 | 설명 |
|---|---|---:|---|
| `result` | `WIN`, `LOSS`, `NONE` | 전체 | 현재 사용자 기준 |
| `page` | integer | 0 | 0 이상 |
| `size` | integer | 20 | 1~100 |

응답 `200`:

```json
{
  "content": [
    {
      "gameId": "3f249b3c-f0a6-4054-8bcf-e6284eec5f3e",
      "startedAt": "2026-07-24T11:20:31Z",
      "endedAt": "2026-07-24T11:27:05Z",
      "myRole": "QUESTIONER",
      "myResult": "WIN",
      "opponent": {
        "id": "70226fe2-cdee-4261-a3cb-fbd87a4df783",
        "nickname": "그린"
      },
      "answerPokemon": {
        "nationalDexId": 25,
        "koreanName": "피카츄",
        "generation": 1,
        "artworkUrl": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",
        "artworkEnabled": true
      },
      "endReason": "CORRECT_GUESS",
      "actionCount": 12
    }
  ],
  "page": 0,
  "size": 20,
  "totalElements": 1,
  "totalPages": 1
}
```

### 8.2 경기 상세

`GET /api/v1/games/{gameId}`

접근: 해당 경기 참가자

응답 `200`:

```json
{
  "gameId": "3f249b3c-f0a6-4054-8bcf-e6284eec5f3e",
  "status": "COMPLETED",
  "startedAt": "2026-07-24T11:20:31Z",
  "endedAt": "2026-07-24T11:27:05Z",
  "answerPokemon": {
    "nationalDexId": 25,
    "koreanName": "피카츄",
    "generation": 1,
    "artworkUrl": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",
    "artworkEnabled": true
  },
  "endReason": "CORRECT_GUESS",
  "actionCount": 12,
  "participants": [
    {
      "userId": "624f7d62-e328-4ff0-8b90-f6520b81a47f",
      "nickname": "레드",
      "role": "QUESTIONER",
      "result": "WIN"
    },
    {
      "userId": "70226fe2-cdee-4261-a3cb-fbd87a4df783",
      "nickname": "그린",
      "role": "SELECTOR",
      "result": "LOSS"
    }
  ],
  "actions": [
    {
      "sequenceNo": 1,
      "type": "QUESTION",
      "question": "전기타입인가요?",
      "answer": "YES",
      "createdAt": "2026-07-24T11:21:00Z",
      "answeredAt": "2026-07-24T11:21:04Z"
    },
    {
      "sequenceNo": 12,
      "type": "GUESS",
      "guessedPokemon": {
        "nationalDexId": 25,
        "koreanName": "피카츄",
        "generation": 1,
        "artworkUrl": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",
        "artworkEnabled": true
      },
      "correct": true,
      "createdAt": "2026-07-24T11:27:05Z"
    }
  ]
}
```

비참가자에게는 resource 존재 여부를 최소 노출하도록 `404 GAME_NOT_FOUND`를 반환한다.

## 9. 운영 REST API

### Health

- `GET /actuator/health/liveness`
- `GET /actuator/health/readiness`

외부에는 `UP`, `DOWN` 수준만 노출한다. DB URL, disk path, component 상세는 내부 healthcheck에서만 사용한다.

## 10. STOMP 연결

### endpoint

```text
wss://<host>/ws
```

- SockJS fallback은 첫 버전에서 사용하지 않는다.
- HTTP session cookie는 WebSocket handshake에 포함된다.
- `CONNECT` header에 REST로 받은 CSRF token을 넣는다.
- 연결 뒤 다음 두 queue를 구독한다.

```text
/user/queue/game-events
/user/queue/errors
```

공개 `/topic/rooms/**`는 만들지 않는다. 서버가 두 참가자에게 사용자별 event를 각각 보낸다.

### heartbeat·reconnect

- client outgoing heartbeat: 10초
- client incoming heartbeat 기대: 10초
- reconnect: 1초부터 시작하는 exponential backoff, 최대 10초
- game 규칙의 60초 deadline은 client 설정이 아니라 server clock으로 계산한다.

## 11. STOMP command envelope

```json
{
  "commandId": "88860116-11d1-477f-bf30-ec8d9d853514",
  "expectedStateVersion": 7,
  "payload": {}
}
```

- `commandId`: client가 한 사용자 행동마다 생성하는 UUID
- `expectedStateVersion`: client가 마지막으로 본 room version
- server는 같은 active game에서 select·question·answer·guess의 `commandId` 중복 적용을 막는다.
- 질문·추측 command ID는 history action row의 unique constraint로 한 번 더 검증한다. 답변 command ID는 active game memory에 유지하며 서버 재시작 뒤 해당 game은 `SERVER_RESTART`로 중단한다.
- 성공한 select·question·answer·guess마다 state version을 1 증가시킨다.
- version 충돌 시 `/user/queue/errors`로 `STALE_ROOM_STATE`와 최신 snapshot 요청 지침을 보낸다.

## 12. STOMP command

### 12.1 정답 선택

destination:

```text
/app/rooms/{roomCode}/select-pokemon
```

payload:

```json
{
  "commandId": "88860116-11d1-477f-bf30-ec8d9d853514",
  "expectedStateVersion": 3,
  "payload": {
    "nationalDexId": 25
  }
}
```

권한: 현재 round 출제자

### 12.2 질문

destination:

```text
/app/rooms/{roomCode}/ask
```

payload:

```json
{
  "commandId": "de2bcb7d-b30e-4806-bf1e-6e194af5bea1",
  "expectedStateVersion": 8,
  "payload": {
    "question": "날개가 있나요?"
  }
}
```

권한: 질문자

20번째 잘못된 추측은 `QUESTION_LIMIT`로 즉시 질문자 패배를 확정한다. 20번째 정답 추측은 `CORRECT_GUESS`가 우선하며 질문자 승리로 끝난다.

### 12.3 답변

destination:

```text
/app/rooms/{roomCode}/answer
```

payload:

```json
{
  "commandId": "992aecaf-19d0-490e-89c5-b8f099f9c4ab",
  "expectedStateVersion": 9,
  "payload": {
    "answer": "NO"
  }
}
```

`answer`: `YES`, `NO`, `UNKNOWN`

권한: 출제자

### 12.4 포켓몬 추측

destination:

```text
/app/rooms/{roomCode}/guess
```

payload:

```json
{
  "commandId": "79c487ff-3d6d-40f5-ab50-4fde0b407786",
  "expectedStateVersion": 10,
  "payload": {
    "nationalDexId": 25
  }
}
```

권한: 질문자

### 12.5 재접속 resume

destination:

```text
/app/rooms/{roomCode}/resume
```

payload:

```json
{
  "commandId": "98835cf8-c6f2-4576-a900-b26519ddbbed",
  "expectedStateVersion": 0,
  "payload": {}
}
```

server는 전달받은 version 대신 현재 상태를 기준으로 역할별 `ROOM_SNAPSHOT`을 보낸다.

### 12.6 재대결 동의

destination:

```text
/app/rooms/{roomCode}/rematch-ready
```

payload:

```json
{
  "commandId": "82b9f92b-8bd4-4ce2-8a0d-822a1ba53836",
  "expectedStateVersion": 22,
  "payload": {
    "ready": true
  }
}
```

두 사용자가 `true`면 역할을 바꾸고 `WAITING_FOR_SELECTION`으로 전환한다.

## 13. STOMP event envelope

```json
{
  "eventId": "2069dc9a-624f-48f9-8b2c-65e912006224",
  "eventType": "QUESTION_ANSWERED",
  "roomCode": "AB3K7M",
  "gameId": "3f249b3c-f0a6-4054-8bcf-e6284eec5f3e",
  "stateVersion": 10,
  "occurredAt": "2026-07-24T11:21:04Z",
  "payload": {}
}
```

client는 `stateVersion`이 현재 값보다 작거나 같은 중복 event를 무시한다.

## 14. STOMP event

### `ROOM_SNAPSHOT`

역할별 전체 상태다. REST `RoomSnapshot`과 같은 노출 규칙을 적용한다.

### `PLAYER_JOINED`

```json
{
  "player": {
    "userId": "70226fe2-cdee-4261-a3cb-fbd87a4df783",
    "nickname": "그린"
  }
}
```

### `ROUND_STARTED`

질문자 payload:

```json
{
  "roundNumber": 1,
  "myRole": "QUESTIONER",
  "opponentRole": "SELECTOR",
  "usedActionCount": 0,
  "remainingActionCount": 20
}
```

출제자 payload만 `selectedPokemon`을 추가한다.

### `QUESTION_ASKED`

```json
{
  "sequenceNo": 1,
  "question": "날개가 있나요?",
  "usedActionCount": 1,
  "remainingActionCount": 19
}
```

### `QUESTION_ANSWERED`

```json
{
  "sequenceNo": 1,
  "question": "날개가 있나요?",
  "answer": "NO",
  "usedActionCount": 1,
  "remainingActionCount": 19
}
```

### `GUESS_RESOLVED`

오답:

```json
{
  "sequenceNo": 2,
  "guessedPokemon": {
    "nationalDexId": 6,
    "koreanName": "리자몽",
    "generation": 1,
    "artworkUrl": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/6.png",
    "artworkEnabled": true
  },
  "correct": false,
  "usedActionCount": 2,
  "remainingActionCount": 18
}
```

정답이면 이어서 `GAME_ENDED`를 보낸다.

### `PLAYER_CONNECTION_CHANGED`

```json
{
  "userId": "70226fe2-cdee-4261-a3cb-fbd87a4df783",
  "connected": false,
  "reconnectDeadline": "2026-07-24T11:24:10Z"
}
```

재접속 성공 시 `connected=true`, `reconnectDeadline=null`이다.

### `GAME_ENDED`

```json
{
  "status": "COMPLETED",
  "answerPokemon": {
    "nationalDexId": 25,
    "koreanName": "피카츄",
    "generation": 1,
    "artworkUrl": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",
    "artworkEnabled": true
  },
  "winnerUserId": "624f7d62-e328-4ff0-8b90-f6520b81a47f",
  "loserUserId": "70226fe2-cdee-4261-a3cb-fbd87a4df783",
  "endReason": "CORRECT_GUESS",
  "usedActionCount": 12
}
```

`ABORTED` 경기에서는 winner·loser가 null이다.

### `REMATCH_STATE_CHANGED`

```json
{
  "meReady": true,
  "opponentReady": false
}
```

두 사용자 준비가 끝나면 새 `ROOM_SNAPSHOT`과 `WAITING_FOR_SELECTION` 상태를 보낸다.

## 15. STOMP error

destination:

```text
/user/queue/errors
```

형식:

```json
{
  "commandId": "de2bcb7d-b30e-4806-bf1e-6e194af5bea1",
  "code": "ANSWER_PENDING",
  "message": "현재 질문의 답변을 기다리고 있습니다.",
  "recoverable": true,
  "latestStateVersion": 9
}
```

대표 code:

- `AUTHENTICATION_REQUIRED`
- `CSRF_INVALID`
- `ROOM_MEMBERSHIP_REQUIRED`
- `ROOM_NOT_FOUND`
- `INVALID_ROLE`
- `INVALID_GAME_STATE`
- `ANSWER_PENDING`
- `NO_PENDING_QUESTION`
- `ACTION_LIMIT_REACHED`
- `POKEMON_NOT_FOUND`
- `DUPLICATE_COMMAND`
- `STALE_ROOM_STATE`
- `VALIDATION_FAILED`
- `INTERNAL_ERROR`

`INTERNAL_ERROR`는 내부 메시지를 노출하지 않고 client에 snapshot 재조회 또는 재시도 경로만 제공한다.

## 16. API 계약 검증

- REST controller 정상·validation·401·403·404·409·429 test
- session cookie와 CSRF 통합 test
- 비참가자 history 접근 test
- STOMP `CONNECT` CSRF·인증 test
- 무단 room command·subscribe test
- selector/questioner DTO 직렬화 test
- questioner payload의 secret field 부재 test
- duplicate command와 stale version test
- WebSocket disconnect·resume·timeout integration test
- 문서 예시와 실제 DTO field가 어긋나지 않는 `ApiDocsTest`
