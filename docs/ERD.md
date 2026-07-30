# Guess Pokémon ERD

- 작성일: 2026-07-26
- DB: PostgreSQL 18.x
- migration: Flyway
- 상태: 공식 논리 설계 기준선

## 1. 설계 원칙

- 모든 영구 시간은 UTC `timestamptz`로 저장한다.
- 애플리케이션은 영속할 `Instant`를 PostgreSQL과 같은 microsecond 정밀도로 맞춰 메모리 상태와 재조회 값이 달라지지 않게 한다.
- 애플리케이션 entity ID는 UUID를 사용한다.
- National Dex 번호는 포켓몬의 안정 식별자로 사용한다.
- 방은 짧은 수명의 메모리 상태이므로 DB table을 만들지 않는다.
- 완료·중단 경기와 행동은 DB에 남긴다.
- enum은 PostgreSQL enum 대신 `varchar + CHECK`를 사용해 migration 부담을 낮춘다.
- login ID와 nickname은 표시값과 normalized key를 분리해 case-insensitive uniqueness를 보장한다.

## 2. 관계도

```mermaid
erDiagram
    APP_USER ||--o{ GAME_PARTICIPANT : participates
    GAME ||--|{ GAME_PARTICIPANT : has
    GAME ||--o{ GAME_ACTION : records
    APP_USER ||--o{ GAME_ACTION : acts
    POKEMON_SPECIES ||--o{ GAME : answer
    POKEMON_SPECIES ||--o{ GAME_ACTION : guessed
    POKEMON_SPECIES o|--o{ POKEMON_SPECIES : evolves_to
    SPRING_SESSION ||--o{ SPRING_SESSION_ATTRIBUTE : contains

    APP_USER {
        uuid id PK
        varchar login_id
        varchar login_id_key UK
        varchar nickname
        varchar nickname_key UK
        varchar password_hash
        varchar status
        timestamptz created_at
        timestamptz updated_at
    }

    POKEMON_SPECIES {
        int national_dex_id PK
        varchar slug UK
        varchar korean_name UK
        smallint generation
        varchar primary_type
        varchar secondary_type
        int evolves_from_national_dex_id FK
        text artwork_url
        varchar catalog_version
        timestamptz source_updated_at
        boolean enabled
    }

    GAME {
        uuid id PK
        uuid round_group_id
        varchar mode
        int answer_pokemon_id FK
        varchar status
        varchar end_reason
        smallint action_count
        bigint state_version
        timestamptz started_at
        timestamptz ended_at
        timestamptz created_at
        timestamptz updated_at
    }

    GAME_PARTICIPANT {
        uuid game_id PK,FK
        uuid user_id PK,FK
        varchar role
        varchar result
        timestamptz created_at
    }

    GAME_ACTION {
        uuid id PK
        uuid command_id UK
        uuid game_id FK
        uuid actor_user_id FK
        smallint sequence_no
        varchar action_type
        varchar question_text
        varchar answer
        varchar answer_comment
        int guessed_pokemon_id FK
        boolean correct
        timestamptz created_at
        timestamptz answered_at
    }

    SPRING_SESSION {
        char primary_id PK
        char session_id UK
        bigint creation_time
        bigint last_access_time
        int max_inactive_interval
        bigint expiry_time
        varchar principal_name
    }

    SPRING_SESSION_ATTRIBUTE {
        char session_primary_id PK,FK
        varchar attribute_name PK
        bytea attribute_bytes
    }
```

`SPRING_SESSION*`은 infrastructure table이며 `APP_USER`와 DB FK를 만들지 않는다. session의 principal name은 Spring Security가 관리한다.

## 3. `app_user`

| Column | Type | Null | Constraint | 설명 |
|---|---|---:|---|---|
| `id` | `uuid` | N | PK | 외부 인증 수단과 분리한 사용자 ID |
| `login_id` | `varchar(30)` | N |  | 사용자 입력 표시값 |
| `login_id_key` | `varchar(30)` | N | UK | trim·lowercase 정규화 값 |
| `nickname` | `varchar(16)` | N |  | 게임 표시 이름 |
| `nickname_key` | `varchar(32)` | N | UK | NFKC·lowercase 중복 비교 값 |
| `password_hash` | `varchar(255)` | N |  | `{bcrypt}...` 등 algorithm prefix 포함 |
| `status` | `varchar(20)` | N | CHECK | `ACTIVE`, `DISABLED` |
| `created_at` | `timestamptz` | N |  | 생성 시각 |
| `updated_at` | `timestamptz` | N |  | 최종 변경 시각 |

추가 제약:

- `login_id_key`는 `^[a-z0-9_]{4,30}$`
- nickname은 application validation에서 2~16자와 금지 제어문자를 검사한다.
- password 원문은 DB column과 entity에 두지 않는다.
- 이메일 인증을 추가할 때 `user_email` 또는 credential table을 별도 migration으로 추가한다.

## 4. `pokemon_species`

| Column | Type | Null | Constraint | 설명 |
|---|---|---:|---|---|
| `national_dex_id` | `integer` | N | PK, CHECK > 0 | 전국도감 번호 |
| `slug` | `varchar(80)` | N | UK | PokéAPI 영문 resource name |
| `korean_name` | `varchar(80)` | N | UK | 공식 한국어 이름 |
| `generation` | `smallint` | N | CHECK 1~9 | 첫 등장 세대 |
| `primary_type` | `varchar(20)` | Y | CHECK | PokéAPI slot 1 타입, 활성 row는 필수 |
| `secondary_type` | `varchar(20)` | Y | CHECK | PokéAPI slot 2 타입, 단일 타입이면 null |
| `evolves_from_national_dex_id` | `integer` | Y | self FK, CHECK | PokéAPI 기준 직접 이전 진화 종 |
| `artwork_url` | `text` | N | HTTPS validation | 기본 official artwork URL |
| `catalog_version` | `varchar(40)` | N |  | canonical snapshot content hash 기반 식별자 |
| `source_updated_at` | `timestamptz` | N |  | snapshot 생성 시각 |
| `enabled` | `boolean` | N | default true | kill switch·누락 대응 |

catalog snapshot은 1~1,025 ID 연속성, slug·한국어 이름 uniqueness, 첫 등장 세대 1~9, default variety, HTTPS artwork URL, 타입과 직접 이전 진화 관계를 import 전에 검증한다. 타입은 `BUG`, `DARK`, `DRAGON`, `ELECTRIC`, `FAIRY`, `FIGHTING`, `FIRE`, `FLYING`, `GHOST`, `GRASS`, `GROUND`, `ICE`, `NORMAL`, `POISON`, `PSYCHIC`, `ROCK`, `STEEL`, `WATER` 중 PokéAPI slot 순서대로 1~2개만 허용한다. 직접 이전 진화 ID는 snapshot 안에 있어야 하며 자기 자신 참조와 cycle을 허용하지 않는다.

`secondary_type`은 `primary_type` 없이 저장할 수 없고 두 타입은 서로 달라야 한다. `enabled=true`인 row는 `primary_type`이 필수다. V4는 기존 row를 먼저 비활성화하고 새 snapshot importer가 타입과 새 catalog version을 같은 transaction으로 upsert하면서 현재 1,025종을 다시 활성화한다. 같은 완전한 version이면 수동 비활성화 상태를 보존하고, 타입이 누락됐거나 version이 바뀌면 전체 현재 snapshot을 복구한다. 현재 snapshot 밖의 과거 version row는 기록 FK 보존을 위해 삭제하지 않고 비활성화한다.

V6는 `evolves_from_national_dex_id`에 `pokemon_species(national_dex_id)` self FK와 자기 참조 금지 `CHECK`를 둔다. importer는 기본 종 upsert 뒤 관계를 별도 batch로 반영해 National Dex 순서와 무관하게 FK를 만족한다. 같은 완전한 version에서 관계만 어긋나면 관계만 복구하고 기존 `enabled=false` 상태를 유지한다. 조회할 때 비활성 관련 종은 진화 관계 응답에서 제외한다.

## 5. `game`

| Column | Type | Null | Constraint | 설명 |
|---|---|---:|---|---|
| `id` | `uuid` | N | PK | 경기 ID |
| `round_group_id` | `uuid` | N | INDEX | 같은 방의 재대결 묶음, 방 자체는 저장하지 않음 |
| `mode` | `varchar(30)` | N | CHECK | `TWENTY_QUESTIONS`, `SILHOUETTE` |
| `answer_pokemon_id` | `integer` | N | FK | 정답 포켓몬 |
| `status` | `varchar(20)` | N | CHECK | `IN_PROGRESS`, `COMPLETED`, `ABORTED` |
| `end_reason` | `varchar(40)` | Y | CHECK | 진행 중에는 null |
| `action_count` | `smallint` | N | mode별 CHECK | 스무고개 0~20, 실루엣 0~3 |
| `state_version` | `bigint` | N | CHECK >= 0 | 상태 전이 version |
| `started_at` | `timestamptz` | N |  | 정답 선택으로 경기 시작 |
| `ended_at` | `timestamptz` | Y |  | 종료·중단 시각 |
| `created_at` | `timestamptz` | N |  | 생성 시각 |
| `updated_at` | `timestamptz` | N |  | 최종 변경 시각 |

`end_reason` 후보:

- `CORRECT_GUESS`
- `QUESTION_LIMIT`
- `GUESS_LIMIT`
- `PLAYER_LEFT`
- `RECONNECT_TIMEOUT`
- `BOTH_DISCONNECTED`
- `SERVER_RESTART`

`COMPLETED`는 앞 네 정상 승패 사유 중 하나를 가진다. `ABORTED`는 `BOTH_DISCONNECTED`, `SERVER_RESTART`만 허용한다.

table-level `CHECK`가 다음 lifecycle 조합을 강제한다.

- `IN_PROGRESS`: `end_reason`, `ended_at` 모두 null
- `COMPLETED`: `CORRECT_GUESS`, `QUESTION_LIMIT`, `GUESS_LIMIT`, `PLAYER_LEFT`, `RECONNECT_TIMEOUT` 중 하나와 `ended_at` not null
- `ABORTED`: `BOTH_DISCONNECTED`, `SERVER_RESTART` 중 하나와 `ended_at` not null
- 종료 시각은 시작 시각보다 빠를 수 없다.

## 6. `game_participant`

| Column | Type | Null | Constraint | 설명 |
|---|---|---:|---|---|
| `game_id` | `uuid` | N | PK, FK | 경기 |
| `user_id` | `uuid` | N | PK, FK | 참가자 |
| `role` | `varchar(20)` | N | UK(game, role), CHECK | `SELECTOR`, `QUESTIONER` |
| `result` | `varchar(20)` | N | CHECK | `WIN`, `LOSS`, `NONE` |
| `created_at` | `timestamptz` | N |  | 생성 시각 |

application과 integration test가 다음 invariant를 검증한다.

- 한 경기 참가자는 정확히 두 명이다.
- 두 참가자의 role은 하나씩이다.
- `COMPLETED` 경기는 `WIN`, `LOSS`가 하나씩이다.
- `ABORTED` 경기는 둘 다 `NONE`이다.

이 invariant는 여러 row를 함께 봐야 하므로 DB `CHECK`만으로 완전히 표현하지 않고 transaction service와 integration test로 보장한다.

## 7. `game_action`

| Column | Type | Null | Constraint | 설명 |
|---|---|---:|---|---|
| `id` | `uuid` | N | PK | 행동 ID |
| `command_id` | `uuid` | N | UK | client 재전송 idempotency key |
| `game_id` | `uuid` | N | FK, UK(game, sequence) | 경기 |
| `actor_user_id` | `uuid` | N | FK(game participant) | 질문자 ID |
| `sequence_no` | `smallint` | N | CHECK 1~20 | 행동 순서 |
| `action_type` | `varchar(20)` | N | CHECK | `QUESTION`, `GUESS` |
| `question_text` | `varchar(200)` | Y |  | 질문 |
| `answer` | `varchar(20)` | Y | CHECK | `YES`, `NO`, `UNKNOWN` |
| `answer_comment` | `varchar(200)` | Y | CHECK | 출제자가 답변에 덧붙인 선택 코멘트 |
| `guessed_pokemon_id` | `integer` | Y | FK | 추측 포켓몬 |
| `correct` | `boolean` | Y |  | 추측 정답 여부 |
| `created_at` | `timestamptz` | N |  | 질문·추측 접수 시각 |
| `answered_at` | `timestamptz` | Y |  | 질문 답변 시각 |

행동별 제약:

- `QUESTION`
  - `question_text` not null
  - `guessed_pokemon_id`, `correct` null
  - 답변 전 `answer`, `answer_comment`, `answered_at` null
  - 답변 뒤 `answer`, `answered_at` not null
  - 답변 뒤 `answer_comment`는 null 또는 공백이 아닌 1~200자
- `GUESS`
  - `guessed_pokemon_id`, `correct` not null
  - `question_text`, `answer`, `answer_comment`, `answered_at` null

Flyway migration에 위 조건을 표현하는 table-level `CHECK`를 둔다.

`(game_id, actor_user_id)`는 `game_participant(game_id, user_id)`를 참조해 참가자가 아닌 사용자의 action row를 막는다. 질문·추측 command ID는 `game_action.command_id`에 영구 저장한다. 답변은 기존 question row를 갱신하므로 active game aggregate의 processed command set에서 중복을 막는다. 첫 버전은 active game을 서버 재시작 뒤 복구하지 않고 `SERVER_RESTART`로 중단하므로 별도 command journal table을 미리 만들지 않는다.

## 8. Spring Session table

Spring Session JDBC의 PostgreSQL schema를 Flyway migration에서 관리한다.

- `spring_session`
- `spring_session_attributes`

애플리케이션 자동 schema 초기화는 끄고 Flyway만 DDL source of truth로 사용한다. session 만료 cleanup은 Spring Session의 repository 기능을 사용한다.
`max_inactive_interval`은 1,800초이며 `principal_name`에는 login ID가 아니라 사용자 UUID 문자열을 저장한다.

## 9. 주요 index

- `app_user(login_id_key)` unique
- `app_user(nickname_key)` unique
- `pokemon_species(korean_name)`
- `pokemon_species(generation, national_dex_id)`
- `pokemon_species(evolves_from_national_dex_id)`
- `game_participant(user_id, game_id)`
- `game(round_group_id)`
- `game(status, updated_at)`
- `game(ended_at desc)`
- `game_action(game_id, sequence_no)` unique
- `game_action(command_id)` unique
- `spring_session(session_id)` unique
- `spring_session(expiry_time)`
- `spring_session(principal_name)`

## 10. Transaction 경계

- signup: user insert 한 transaction
- catalog import: 타입·직접 진화 관계를 포함한 snapshot 전체 검증 뒤 기본 종 upsert와 관계 update를 한 transaction
- game start: game + participant 2건 한 transaction
- question submit: action insert + game count/version update 한 transaction
- answer: action answer·선택 코멘트 + game version·종료 여부 update 한 transaction
- guess: action insert + game count/version + participant result·game end update 한 transaction
- reconnect timeout: participant result + game end update 한 transaction

game command는 기존 memory aggregate를 직접 바꾸지 않고 immutable candidate를 만든다. persistence transaction이 commit한 뒤에만 candidate를 현재 memory state로 교체한다. commit이 실패하면 기존 aggregate를 유지한다. WebSocket event는 transaction commit과 memory 교체 뒤 전송하며, commit이 실패하면 성공 event를 보내지 않는다.

## 11. 삭제와 보존

- 첫 버전은 사용자 계정 삭제 기능을 제공하지 않는다.
- 경기·질문 기록의 자동 삭제 정책을 넣지 않는다.
- 실제 공개 운영 전에 개인정보·사용자 생성 콘텐츠 보존 정책을 다시 결정해야 한다.
- DB backup 삭제와 restore는 별도 운영 승인 대상이다.

## 12. Migration 순서

| Version | 책임 |
|---|---|
| `V1__create_user_and_session_tables.sql` | 사용자, Spring Session |
| `V2__create_pokemon_catalog.sql` | 포켓몬 catalog |
| `V3__create_game_history.sql` | 경기, 참가자, 행동 |
| `V4__add_pokemon_types.sql` | catalog 타입 column·제약과 안전한 재적재 준비 |
| `V5__add_answer_comment.sql` | 선택 답변 코멘트 column·형식 제약 |
| `V6__add_pokemon_evolution_relation.sql` | 직접 이전 진화 self FK·자기 참조 금지 제약·조회 index |

각 migration commit은 빈 DB 적용, 재시작, Testcontainers integration test를 통과해야 한다. 이미 적용한 migration 파일은 수정하지 않고 후속 migration을 추가한다.
같은 migration 파일을 Testcontainers 임시 DB, MacBook 개발 DB, Mac mini 운영 DB 순서로 적용하며 환경별 SQL을 따로 만들지 않는다.
