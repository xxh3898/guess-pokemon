# 개발·배포·백업 운영 플레이북

## 1. 문서의 역할

이 문서는 Guess Pokémon의 개발, GitHub Actions 검증, Mac mini 자동 배포,
Flyway migration, local snapshot, age/iCloud 복사와 복구 흐름을 한 번에
설명하는 상위 안내서다. 명령의 세부 구현은 아래 source of truth를 따른다.

- CI 분기: `.github/workflows/validate.yml`, `scripts/classify-ci-paths.sh`
- release: `.github/workflows/deploy.yml`
- 운영 구성: `compose.production.yaml`
- 배포 worker: `scripts/deploy-guess-pokemon.sh`
- 백업 worker: `scripts/backup-production-db.sh`
- 고정 진입점: `scripts/*-bootstrap.sh`, `scripts/*-ci.sh`
- 운영 상세: `docs/OPERATIONS.md`

저장소 파일을 병합하는 것만으로 LaunchAgent, heartbeat URL, age recipient가
Mac mini에 설치되지는 않는다. GitHub 변수·secret과 `/Users/homeserver/Server`
변경도 각각 별도 운영 작업이다.

## 2. 변하지 않는 원칙

1. Guess Pokémon은 다른 프로젝트의 저장소, DB, volume, network, backup 또는
   credential에 의존하지 않는다.
2. API와 Web은 항상 같은 40자리 commit SHA의 image pair로 배포한다.
3. `main` 병합은 release 의사 표시이며, 검증 성공과 kill switch 활성 상태에서
   즉시 자동 배포한다.
4. DB schema source of truth는 append-only Flyway versioned migration이다.
5. local 정상 snapshot을 먼저 확정하고, raw data가 아닌 age ciphertext만
   iCloud Drive에 전달한다.
6. DB migration, image rollback, DB restore는 서로 다른 상태 전이다.
7. backup 삭제, 운영 restore, deploy·restart와 GitHub 설정 변경은 각각 별도
   승인을 요구한다.

## 3. 개발과 branch 흐름

```text
feature branch
  -> local focused test
  -> dev 또는 main 대상 PR
  -> stable required check 5개
  -> review와 unresolved finding 판정
  -> main 병합
  -> release 전체 검증
  -> exact SHA image publish
  -> Mac mini 자동 배포
```

- 운영 코드나 설정을 `main`에서 직접 수정하지 않는다.
- path-aware CI는 관련 component만 무거운 검증을 실행한다.
- 관련 없는 required job도 사라지지 않고 명시적 safe-skip 성공으로 남는다.
- 분류할 수 없는 runtime path, classifier, workflow, `.gitattributes` 변경은
  안전하게 전체 검증으로 fallback한다.
- reusable validation이 `refs/heads/main`에서 호출되면 path 결과와 무관하게
  전체 검증한다. 따라서 release 이전에 infrastructure, backend, frontend와
  두 ARM64 image 계약이 모두 확인된다.

| 변경 범위 | 실제 무거운 검증 | safe-skip |
| --- | --- | --- |
| frontend source | Frontend checks, Web ARM64 image | Infrastructure, Backend, API image |
| backend source | Backend checks, API ARM64 image | Infrastructure, Frontend, Web image |
| infrastructure | Infrastructure checks | Backend, Frontend, API/Web image |
| 미분류·workflow·classifier | 5개 전체 | 없음 |

## 4. main release와 배포 상태 전이

`deploy.yml`의 workflow 이름은 `Publish and Deploy`다. 정상 운영에서는
repository variable `MAC_MINI_DEPLOY_ENABLED=true`가 필요하다. 이 값이 없거나
`true`가 아니면 validation은 실행되지만 publish와 deploy는 건너뛴다.

```text
release validation
  -> API/Web ARM64 exact SHA publish
  -> runtime-config 변경 여부 판정과 exact digest publish
  -> Tailscale OIDC 연결
  -> 제한 SSH wrapper
  -> current runtime/config 검증
  -> IN_PROGRESS game 0 대기
  -> predeploy local snapshot
  -> pending 기록
  -> candidate image의 one-shot Flyway
  -> API/Web same-SHA cutover
  -> Compose readiness
  -> public Web/deep link/API/asset smoke
  -> state/current 확정
```

진행 중 game은 60초 간격, 최대 15분 동안 기다린다. 남아 있으면 backup이나
cutover 전에 실패한다. Public smoke 대상은 Web `/`, deep link `/history`,
API readiness, 대표 Pokémon read endpoint와 현재 HTML이 가리키는
`/assets/*.js`다. public smoke 전에는 새 state를 성공으로 쓰지 않는다.

## 5. Flyway migration 계약

- 일반 API container는 `SPRING_FLYWAY_ENABLED=false`로 시작한다.
- 배포 worker는 exact candidate API image에서
  `com.guesspokemon.ops.MigrationMain`만 one-shot으로 실행한다.
- one-shot subprocess에 candidate API/Web image pair를 함께 주입하고
  `--pull never`로 이미 revision label을 검증한 local image만 사용한다. 이
  임시 값은 Compose interpolation에만 적용하며 production `.env`는 migration
  성공 전까지 현재 image pair를 유지한다.
- runner는 game recovery나 catalog importer 같은 `ApplicationRunner`를
  시작하지 않고 Flyway migration과 Flyway validate만 수행한다.
- candidate API startup은 `ddl-auto=validate`로 JPA mapping과 실제 schema를
  검증한다. 이 검증 또는 readiness가 실패하면 이전 image pair로 돌아간다.
- migration 실패 시 `.env`와 실행 중 API/Web을 바꾸지 않고 `pending`을 남겨
  명시적 recovery가 가능하게 한다.
- 이미 성공한 DB migration은 image rollback이 자동으로 되돌리지 않는다.
- `DROP`, `TRUNCATE`, 호환되지 않는 rename/type 변경은 일반 main 자동
  release에 넣지 않는다. expand/contract와 별도 DB 작업으로 분리한다.

## 6. local snapshot 계약

Backup worker는 `--trigger scheduled`와 `--trigger predeploy`만 허용한다.
Scheduled backup은 game을 중지하거나 기다리지 않는다. Predeploy는 deploy
worker가 game 0 gate를 먼저 통과한다. Local snapshot 실패는 배포 hard gate다.

```text
guess-pokemon-production-<UTC timestamp>/
├── SUCCESS
├── manifest.json
├── database/
│   ├── dump
│   ├── record-counts.tsv
│   └── version.txt
└── files/
    └── sha256.txt
```

생성 순서:

1. verified runtime release와 production `db` 확인
2. PostgreSQL custom-format `pg_dump`
3. `pg_restore --list` 구조 검증
4. DB에 연결하지 않은 `pg_restore --data-only --schema=public --file=-`가 stdout에
   생성한 COPY SQL stream으로 custom archive와 같은 snapshot의 public table row count 계산
5. DB engine/version, row-count source와 중요 table별 count 기록
6. file data 미사용을 나타내는 빈 checksum manifest 기록
7. application SHA와 runtime config digest 기록
8. `manifest.json` 생성
9. `SUCCESS` 마지막 생성
10. 같은 filesystem 안에서 최종 directory로 atomic rename

Manifest에는 password, token, DB URL, email을 넣지 않는다. Memory에 있는
진행 중 room과 timer는 backup 대상이 아니며, persisted `IN_PROGRESS` game은
복구 후 startup recovery 정책으로 `ABORTED` 처리한다.
`--file=-`는 generated SQL의 output target을 stdout으로 명시한다. 이 계약이나 COPY
coverage 검증이 실패하면 `SUCCESS`와 manifest를 만들기 전에 backup을 중단한다.

## 7. schedule과 retention

LaunchAgent template은
`launchd/com.homeserver.guess-pokemon-backup.plist.example`이다. KST 기준
`00:20`, `06:20`, `12:20`, `18:20`에 고정 bootstrap을 호출한다.
`KeepAlive`는 사용하지 않는다. Deploy와 backup은 같은 project operation
lock을 사용한다.

현재 retention은 삭제가 아닌 dry-run plan만 만든다.

- recent: 최신 정상 snapshot 4개
- daily: 지난 7 calendar day마다 06:00 이후 첫 정상 snapshot 1개
- recent/daily 중복 제거
- `SUCCESS`, manifest, dump checksum과 dump-derived row-count provenance를
  다시 통과한 snapshot만 정상본
- symlink, 예상 밖 이름, 불완전 snapshot은 삭제 후보에서 제외
- 결과: `<backup-root>/retention-plan.json`

최초 7일 관찰, remote decrypt/restore drill과 별도 backup 삭제 승인 전에는
`pruneCandidates`를 실제 삭제하지 않는다.

## 8. age·iCloud와 heartbeat

- public recipient: 운영 app directory의 mode `0600`
  `backup-age-recipient-v1.txt`
- private identity: MacBook local login Keychain만 사용
- local ciphertext staging: `/Users/homeserver/Server/backups/guess-pokemon/offsite/`
- iCloud final:
  `~/Library/Mobile Documents/com~apple~CloudDocs/HomeServerBackups/guess-pokemon/`

Snapshot directory를 tar stream으로 만들고 recipient file로 age 암호화한다.
Ciphertext header와 SHA-256을 확인한 뒤 iCloud의 `.partial` 파일로 복사하고,
hash가 같을 때만 final `.tar.age`로 rename한다. iCloud에는 raw dump가
들어가지 않는다. iCloud local folder handoff는 remote upload 완료 판정이
아니다.

선택적 heartbeat 설정은 app directory의 mode `0600`
`backup-heartbeats.conf`다. 정확히 아래 두 key만 허용하며 실제 URL은 Git,
문서, 로그에 기록하지 않는다.

```text
LOCAL_HEARTBEAT_URL=<Uptime Kuma push URL>
ICLOUD_STAGE_HEARTBEAT_URL=<Uptime Kuma push URL>
```

Local heartbeat는 snapshot publish 뒤, iCloud-stage heartbeat는 ciphertext
handoff 뒤에만 보낸다. 운영 monitor 기준은 local 7시간, iCloud-stage
8시간 grace이며 hook 설치 전에는 pause 상태를 유지한다.

## 9. 복구 원칙

1. trusted MacBook에서 iCloud ciphertext를 materialize한다.
2. ciphertext SHA-256과 age header를 확인한다.
3. Keychain identity를 stdout/file에 노출하지 않고 pipe로 age에 전달한다.
4. 격리된 Mac mini 개발용 PostgreSQL volume에만 복구한다.
5. manifest, dump hash, row count, Flyway history, constraint와 대표 read-only
   API를 검증한다.
6. persisted `IN_PROGRESS` game의 startup recovery도 확인한다.
7. elapsed time과 결과를 기록한다.
8. 운영 restore가 필요하면 write freeze와 별도 승인을 다시 받는다.

## 10. 실패와 rollback 표

| 실패 지점 | 자동 동작 | DB 상태 |
| --- | --- | --- |
| release validation | publish/deploy 없음 | 불변 |
| active game timeout | backup/cutover 없음 | 불변 |
| local snapshot | cutover 없음 | 불변 |
| one-shot migration | 기존 app 유지, pending 보존 | 일부 적용 가능성 조사 |
| candidate readiness/JPA validate | 이전 image/config 재적용 | migration 유지 |
| public smoke | 이전 image/config 재적용 후 public smoke 재확인 | migration 유지 |
| iCloud handoff | scheduled 실패 또는 predeploy generic 경고 | local snapshot 유지 |
| heartbeat 전송 | generic 경고, 다음 monitor timeout 관찰 | snapshot 유지 |

`docker compose down -v`, broad cleanup, 자동 reverse migration과 자동 운영
restore는 rollback 수단이 아니다.

## 11. 새 프로젝트 추가 체크리스트

새 프로젝트는 이 계약을 복사하되 실행 코드, DB와 credential은 독립적으로
구현한다.

- [ ] project slug, Compose project name, API/Web image repository 확정
- [ ] `dev`/PR/main branch와 stable required job 5개 확정
- [ ] path classifier의 component·unknown fallback test 추가
- [ ] main full validation과 exact SHA publish dependency 추가
- [ ] kill switch, concurrency group, GitHub Environment, Tailscale wrapper 확정
- [ ] DB engine별 logical dump·validator·row-count adapter 구현
- [ ] file data 포함 여부와 checksum/reference adapter 구현
- [ ] snapshot schema v1, `SUCCESS` last, atomic publish test 추가
- [ ] recent 4 + daily 7 dry-run retention table test 추가
- [ ] isolated one-shot Flyway와 API startup schema validate 추가
- [ ] project별 quiescence hook과 public Web/deep/API/asset smoke 정의
- [ ] age recipient, iCloud project directory, heartbeat config 경로 분리
- [ ] 6시간 stagger schedule과 project lock 추가
- [ ] 격리 restore drill, RTO 측정과 운영 restore 승인 절차 작성
- [ ] Server 설치, GitHub 설정, monitor activation을 repository merge와 분리

## 12. 운영 전 최종 확인

- repository focused test와 hosted required check 성공
- `MAC_MINI_DEPLOY_ENABLED=true` readback
- current/previous exact SHA와 runtime config digest 확인
- 최신 정상 local snapshot과 remote decrypt 가능성 확인
- migration 종류가 additive/backward-compatible인지 확인
- active game 0, public smoke와 rollback image availability 확인
- operation lock과 `pending` 부재 확인
- merge가 즉시 production deploy를 시작한다는 최종 승인
