import {
  CircleX,
  DoorOpen,
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
  MAX_SILHOUETTE_GUESS_COUNT,
  type ResultRoomSnapshot,
  type RoomMember,
  type RoomRole,
} from "../room/roomTypes";
import { RolePreferencePanel } from "../room/RolePreferencePanel";
import { GameActionTimeline } from "./GameActionTimeline";

interface GameResultScreenProps {
  commandPending: boolean;
  connected: boolean;
  onLeave(): void;
  onRolePreference(role: RoomRole): void;
  snapshot: ResultRoomSnapshot;
}

export function GameResultScreen({
  commandPending,
  connected,
  onLeave,
  onRolePreference,
  snapshot,
}: GameResultScreenProps) {
  const winner = snapshot.game.winnerUserId;
  const aborted = snapshot.game.status === "ABORTED";
  const won = winner === snapshot.me.userId;
  const roomRemoved =
    snapshot.game.endReason === "PLAYER_LEFT";
  const maximum =
    snapshot.mode === "SILHOUETTE"
      ? MAX_SILHOUETTE_GUESS_COUNT
      : MAX_GAME_ACTION_COUNT;
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
          <span>/ {maximum}</span>
        </div>
      </section>

      <section className="result-detail-column">
        <div className="result-participants panel-card">
          <h2>참가자</h2>
          <ResultParticipant
            member={snapshot.me}
            mode={snapshot.mode}
            winnerUserId={winner}
          />
          <ResultParticipant
            member={snapshot.opponent}
            mode={snapshot.mode}
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
          <div className="result-role-selection">
            {snapshot.mode === "SILHOUETTE" ? (
              <p className="result-fixed-mode-note">
                이 방은 실루엣 퀴즈로 계속 진행해요.
              </p>
            ) : null}
            <RolePreferencePanel
              commandPending={commandPending}
              connected={connected}
              me={snapshot.me}
              mode={snapshot.mode}
              onSelect={onRolePreference}
              opponent={snapshot.opponent}
              selection={snapshot.roleSelection}
              title="다음 게임 역할 선택"
            />
            <button
              className="secondary-game-button result-lobby-button"
              disabled={commandPending}
              onClick={onLeave}
              type="button"
            >
              <DoorOpen aria-hidden="true" size={18} />
              로비로
            </button>
          </div>
        )}

        <GameActionTimeline
          actions={snapshot.game.actions}
          silhouette={snapshot.mode === "SILHOUETTE"}
        />
      </section>
    </div>
  );
}

function ResultParticipant({
  member,
  mode,
  winnerUserId,
}: {
  member: RoomMember;
  mode: ResultRoomSnapshot["mode"];
  winnerUserId: string | null;
}) {
  const won = member.userId === winnerUserId;
  return (
    <article>
      <UserRound aria-hidden="true" size={34} />
      <div>
        <strong>{member.nickname}</strong>
        <span>
          {member.role === "QUESTIONER"
            ? mode === "SILHOUETTE"
              ? "도전자"
              : "질문자"
            : member.role === "SELECTOR"
              ? "출제자"
              : "역할 미정"}
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

function endReasonCopy(
  reason: ResultRoomSnapshot["game"]["endReason"],
): string {
  return {
    BOTH_DISCONNECTED: "두 참가자의 연결이 모두 끊겼어요.",
    CORRECT_GUESS: "정답 포켓몬을 맞혔어요.",
    PLAYER_LEFT: "상대가 게임에서 나갔어요.",
    GUESS_LIMIT: "세 번의 추측 기회를 모두 사용했어요.",
    QUESTION_LIMIT: "스무 번의 기회를 모두 사용했어요.",
    RECONNECT_TIMEOUT: "재접속 대기 시간이 끝났어요.",
    SERVER_RESTART: "서버가 다시 시작되어 경기를 중단했어요.",
  }[reason];
}
