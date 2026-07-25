import {
  Check,
  CircleHelp,
  LockKeyhole,
  Search,
  Send,
  UserRound,
  X,
} from "lucide-react";
import {
  useMemo,
  useState,
  type FormEvent,
} from "react";

import {
  PokemonArtwork,
  formatNationalDexId,
} from "../pokemon/PokemonArtwork";
import { PokemonTypeBadges } from "../pokemon/PokemonTypeBadges";
import {
  MAX_GAME_ACTION_COUNT,
  type ActiveRoomSnapshot,
  type GameAnswer,
  type QuestionGameAction,
} from "../room/roomTypes";
import { GameActionTimeline } from "./GameActionTimeline";

interface GameScreenProps {
  commandPending: boolean;
  onAnswer(answer: GameAnswer): void;
  onAsk(question: string): void;
  onOpenPokedex(): void;
  snapshot: ActiveRoomSnapshot;
}

export function GameScreen({
  commandPending,
  onAnswer,
  onAsk,
  onOpenPokedex,
  snapshot,
}: GameScreenProps) {
  const isSelector = "selectedPokemon" in snapshot.game;
  const pendingQuestion = useMemo(
    () => findPendingQuestion(snapshot.game.actions),
    [snapshot.game.actions],
  );

  return (
    <div
      className={`game-layout ${
        isSelector ? "selector-layout" : "questioner-layout"
      }`}
    >
      <aside className="game-role-column">
        {isSelector ? (
          <section className="secret-pokemon-card panel-card">
            <p className="role-pill selector-pill">
              내 역할 · 출제자
            </p>
            <span>내가 선택한 포켓몬</span>
            <PokemonArtwork
              pokemon={snapshot.game.selectedPokemon}
            />
            <h2>
              {formatNationalDexId(
                snapshot.game.selectedPokemon.nationalDexId,
              )}{" "}
              {snapshot.game.selectedPokemon.koreanName}
            </h2>
            <PokemonTypeBadges
              types={snapshot.game.selectedPokemon.types}
            />
            <p className="secret-copy">
              <LockKeyhole aria-hidden="true" size={16} />
              정답은 상대에게 비공개
            </p>
          </section>
        ) : (
          <RoleCard
            label="내 역할 · 질문자"
            member={snapshot.me}
            tone="blue"
          />
        )}
        {!isSelector ? (
          <RoleCard
            label="상대 · 출제자"
            member={snapshot.opponent}
            tone="mint"
          />
        ) : null}
        <RemainingActions
          remaining={snapshot.game.remainingActionCount}
        />
      </aside>

      <GameActionTimeline actions={snapshot.game.actions} />

      <section className="game-command-column">
        {isSelector ? (
          <AnswerPanel
            commandPending={commandPending}
            onAnswer={onAnswer}
            pendingQuestion={pendingQuestion}
            paused={snapshot.status === "PAUSED"}
          />
        ) : (
          <QuestionPanel
            commandPending={commandPending}
            onAsk={onAsk}
            onOpenPokedex={onOpenPokedex}
            paused={snapshot.status === "PAUSED"}
            pendingQuestion={pendingQuestion}
            remaining={snapshot.game.remainingActionCount}
          />
        )}
      </section>
    </div>
  );
}

function RoleCard({
  label,
  member,
  tone,
}: {
  label: string;
  member: ActiveRoomSnapshot["me"];
  tone: "blue" | "mint";
}) {
  return (
    <section className={`game-role-card panel-card ${tone}-role`}>
      <p className={`role-pill ${tone}-pill`}>{label}</p>
      <UserRound aria-hidden="true" size={54} strokeWidth={1.5} />
      <h2>{member.nickname}</h2>
      <p className="member-connection-copy">
        <span aria-hidden="true" />
        {member.connected ? "연결됨" : "연결 끊김"}
      </p>
    </section>
  );
}

function RemainingActions({ remaining }: { remaining: number }) {
  return (
    <section
      aria-label={`남은 기회 ${remaining}회`}
      className="remaining-actions panel-card"
    >
      <span>남은 기회</span>
      <strong>{remaining}</strong>
      <span>/ {MAX_GAME_ACTION_COUNT}</span>
      <div aria-hidden="true" className="action-dots">
        {Array.from(
          { length: MAX_GAME_ACTION_COUNT },
          (_, index) => (
            <i
              className={
                index < remaining ? "is-remaining" : ""
              }
              key={index}
            />
          ),
        )}
      </div>
    </section>
  );
}

interface QuestionPanelProps {
  commandPending: boolean;
  onAsk(question: string): void;
  onOpenPokedex(): void;
  paused: boolean;
  pendingQuestion: QuestionGameAction | null;
  remaining: number;
}

function QuestionPanel({
  commandPending,
  onAsk,
  onOpenPokedex,
  paused,
  pendingQuestion,
  remaining,
}: QuestionPanelProps) {
  const [question, setQuestion] = useState("");
  const blocked =
    commandPending ||
    paused ||
    pendingQuestion !== null ||
    remaining === 0;
  const normalized = question.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (blocked || normalized.length === 0) {
      return;
    }
    onAsk(normalized);
    setQuestion("");
  };
  return (
    <form className="question-composer panel-card" onSubmit={submit}>
      <h2>질문하기</h2>
      <p>
        {pendingQuestion
          ? "출제자의 답변을 기다리고 있어요."
          : "예 또는 아니요로 답할 수 있는 질문을 입력해 주세요."}
      </p>
      <label>
        <span className="sr-only">질문</span>
        <textarea
          aria-label="질문"
          disabled={blocked}
          maxLength={200}
          onChange={(event) => {
            setQuestion(event.target.value);
          }}
          placeholder={
            pendingQuestion
              ? "답변을 기다리는 동안 새 질문을 보낼 수 없어요"
              : "예: 날개가 있나요?"
          }
          value={question}
        />
        <small>{question.length}/200</small>
      </label>
      <div className="question-actions">
        <button
          className="secondary-game-button"
          disabled={paused}
          onClick={onOpenPokedex}
          type="button"
        >
          <Search aria-hidden="true" size={19} />
          전국도감 보기
        </button>
        <button
          className="primary-game-button"
          disabled={blocked || normalized.length === 0}
          type="submit"
        >
          <Send aria-hidden="true" size={19} />
          질문하기
        </button>
      </div>
    </form>
  );
}

interface AnswerPanelProps {
  commandPending: boolean;
  onAnswer(answer: GameAnswer): void;
  paused: boolean;
  pendingQuestion: QuestionGameAction | null;
}

function AnswerPanel({
  commandPending,
  onAnswer,
  paused,
  pendingQuestion,
}: AnswerPanelProps) {
  const disabled =
    commandPending || paused || pendingQuestion === null;
  return (
    <section className="answer-panel panel-card">
      <header>
        <CircleHelp aria-hidden="true" size={20} />
        <h2>답변을 기다리는 질문</h2>
      </header>
      {pendingQuestion ? (
        <>
          <span>
            Q {String(pendingQuestion.sequenceNumber).padStart(2, "0")}
          </span>
          <strong>{pendingQuestion.question}</strong>
        </>
      ) : (
        <p>질문자가 다음 질문을 준비하고 있어요.</p>
      )}
      <div className="answer-buttons">
        <button
          className="yes-button"
          disabled={disabled}
          onClick={() => {
            onAnswer("YES");
          }}
          type="button"
        >
          <Check aria-hidden="true" size={22} />예
        </button>
        <button
          className="no-button"
          disabled={disabled}
          onClick={() => {
            onAnswer("NO");
          }}
          type="button"
        >
          <X aria-hidden="true" size={22} />
          아니요
        </button>
        <button
          className="unknown-button"
          disabled={disabled}
          onClick={() => {
            onAnswer("UNKNOWN");
          }}
          type="button"
        >
          <CircleHelp aria-hidden="true" size={22} />
          모르겠어요
        </button>
      </div>
    </section>
  );
}

function findPendingQuestion(
  actions: ActiveRoomSnapshot["game"]["actions"],
): QuestionGameAction | null {
  const last = actions.at(-1);
  return last?.type === "QUESTION" && last.answer === null
    ? last
    : null;
}
