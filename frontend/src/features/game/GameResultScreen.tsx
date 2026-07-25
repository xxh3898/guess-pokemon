import {
  Check,
  CircleX,
  DoorOpen,
  RefreshCw,
  Trophy,
  UserRound,
} from "lucide-react";

import {
  PokemonArtwork,
  formatNationalDexId,
} from "../pokemon/PokemonArtwork";
import { PokemonTypeBadges } from "../pokemon/PokemonTypeBadges";
import {
  MAX_GAME_ACTION_COUNT,
  type ResultRoomSnapshot,
  type RoomMember,
} from "../room/roomTypes";
import { GameActionTimeline } from "./GameActionTimeline";

interface GameResultScreenProps {
  commandPending: boolean;
  onLeave(): void;
  onRematch(ready: boolean): void;
  snapshot: ResultRoomSnapshot;
}

export function GameResultScreen({
  commandPending,
  onLeave,
  onRematch,
  snapshot,
}: GameResultScreenProps) {
  const winner = snapshot.game.winnerUserId;
  const aborted = snapshot.game.status === "ABORTED";
  const won = winner === snapshot.me.userId;
  const roomRemoved =
    snapshot.game.endReason === "PLAYER_LEFT";
  const outcome = aborted
    ? {
        detail: endReasonCopy(snapshot.game.endReason),
        title: "경기가 중단됐어요",
        tone: "aborted",
      }
    : won
      ? {
          detail: endReasonCopy(snapshot.game.endReason),
          title: "승리했어요",
          tone: "won",
        }
      : {
          detail: endReasonCopy(snapshot.game.endReason),
          title: "패배했어요",
          tone: "lost",
        };

  return (
    <div className="result-layout">
      <section className={`result-summary result-${outcome.tone}`}>
        <p>게임 결과</p>
        <h1>{outcome.title}</h1>
        <span>{outcome.detail}</span>
        <article className="answer-reveal-card panel-card">
          <div>
            <span className="answer-reveal-label">정답 공개</span>
            <small>
              {formatNationalDexId(
                snapshot.game.answerPokemon.nationalDexId,
              )}
            </small>
            <strong>
              {snapshot.game.answerPokemon.koreanName}
            </strong>
            <PokemonTypeBadges
              types={snapshot.game.answerPokemon.types}
            />
          </div>
          <PokemonArtwork
            pokemon={snapshot.game.answerPokemon}
          />
        </article>
        <div className="used-action-summary panel-card">
          <span>사용한 기회</span>
          <strong>{snapshot.game.usedActionCount}</strong>
          <span>/ {MAX_GAME_ACTION_COUNT}</span>
        </div>
      </section>

      <section className="result-detail-column">
        <div className="result-participants panel-card">
          <h2>참가자</h2>
          <ResultParticipant
            member={snapshot.me}
            winnerUserId={winner}
          />
          <ResultParticipant
            member={snapshot.opponent}
            winnerUserId={winner}
          />
        </div>

        {roomRemoved ? (
          <div className="result-room-closed panel-card">
            <CircleX aria-hidden="true" size={23} />
            <div>
              <h2>상대가 게임에서 나갔어요</h2>
              <p>
                이 방은 종료되어 재대결할 수 없어요. 로비에서 새
                방을 만들어 주세요.
              </p>
            </div>
            <button onClick={onLeave} type="button">
              <DoorOpen aria-hidden="true" size={18} />
              로비로
            </button>
          </div>
        ) : (
          <section className="rematch-panel panel-card">
            <h2>재대결 준비</h2>
            <p>두 사람 모두 준비하면 역할을 바꿔 시작해요.</p>
            <div className="rematch-members">
              <ReadyState
                label="나"
                member={snapshot.me}
                ready={snapshot.rematch.meReady}
              />
              <ReadyState
                label="상대"
                member={snapshot.opponent}
                ready={snapshot.rematch.opponentReady}
              />
            </div>
            <div className="rematch-actions">
              <button
                className="primary-game-button"
                disabled={
                  commandPending ||
                  (snapshot.rematch.opponentReady &&
                    snapshot.rematch.meReady)
                }
                onClick={() => {
                  onRematch(!snapshot.rematch.meReady);
                }}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={18} />
                {snapshot.rematch.meReady
                  ? "준비 취소"
                  : "재대결 준비"}
              </button>
              <button
                className="secondary-game-button"
                disabled={commandPending}
                onClick={onLeave}
                type="button"
              >
                <DoorOpen aria-hidden="true" size={18} />
                로비로
              </button>
            </div>
          </section>
        )}

        <GameActionTimeline actions={snapshot.game.actions} />
      </section>
    </div>
  );
}

function ResultParticipant({
  member,
  winnerUserId,
}: {
  member: RoomMember;
  winnerUserId: string | null;
}) {
  const won = member.userId === winnerUserId;
  return (
    <article>
      <UserRound aria-hidden="true" size={34} />
      <div>
        <strong>{member.nickname}</strong>
        <span>
          {member.role === "QUESTIONER" ? "질문자" : "출제자"}
        </span>
      </div>
      {winnerUserId ? (
        <em className={won ? "is-winner" : "is-loser"}>
          {won ? (
            <Trophy aria-hidden="true" size={16} />
          ) : (
            <CircleX aria-hidden="true" size={16} />
          )}
          {won ? "승리" : "패배"}
        </em>
      ) : (
        <em>중단</em>
      )}
    </article>
  );
}

function ReadyState({
  label,
  member,
  ready,
}: {
  label: string;
  member: RoomMember;
  ready: boolean;
}) {
  return (
    <article className={ready ? "is-ready" : ""}>
      <UserRound aria-hidden="true" size={28} />
      <div>
        <span>{label}</span>
        <strong>{member.nickname}</strong>
      </div>
      <em>
        {ready ? (
          <>
            <Check aria-hidden="true" size={16} />
            준비 완료
          </>
        ) : (
          "준비 중"
        )}
      </em>
    </article>
  );
}

function endReasonCopy(
  reason: ResultRoomSnapshot["game"]["endReason"],
): string {
  return {
    BOTH_DISCONNECTED: "두 참가자의 연결이 모두 끊겼어요.",
    CORRECT_GUESS: "정답 포켓몬을 맞혔어요.",
    PLAYER_LEFT: "상대가 게임에서 나갔어요.",
    QUESTION_LIMIT: "스무 번의 기회를 모두 사용했어요.",
    RECONNECT_TIMEOUT: "재접속 대기 시간이 끝났어요.",
    SERVER_RESTART: "서버가 다시 시작되어 경기를 중단했어요.",
  }[reason];
}
