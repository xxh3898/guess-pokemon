import {
  Check,
  CircleHelp,
  Clock3,
  X,
} from "lucide-react";
import {
  useLayoutEffect,
  useRef,
} from "react";

import { formatNationalDexId } from "../pokemon/PokemonArtwork";
import type { GameAction } from "../room/roomTypes";

const TIMELINE_END_THRESHOLD = 32;

export function GameActionTimeline({
  actions,
}: {
  actions: readonly GameAction[];
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const readerAtEndRef = useRef(true);
  const revision = timelineRevision(actions);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !readerAtEndRef.current) {
      return;
    }
    list.scrollTop = list.scrollHeight;
  }, [revision]);

  return (
    <section
      aria-labelledby="game-timeline-title"
      className="game-timeline panel-card"
    >
      <header className="game-panel-heading">
        <Clock3 aria-hidden="true" size={20} />
        <h2 id="game-timeline-title">질문 &amp; 답변 기록</h2>
      </header>
      {actions.length === 0 ? (
        <div className="game-empty-timeline">
          첫 질문을 기다리고 있어요.
        </div>
      ) : (
        <ol
          aria-label="질문과 답변 기록 목록"
          onScroll={(event) => {
            const list = event.currentTarget;
            readerAtEndRef.current =
              list.scrollHeight -
                list.scrollTop -
                list.clientHeight <=
              TIMELINE_END_THRESHOLD;
          }}
          ref={listRef}
          tabIndex={0}
        >
          {actions.map((action) => (
            <li key={action.sequenceNumber}>
              <span className="action-sequence">
                {String(action.sequenceNumber).padStart(2, "0")}
              </span>
              <span
                className={`action-kind${
                  action.type === "GUESS"
                    ? ` is-guess${
                        action.correct ? " is-correct" : ""
                      }`
                    : ""
                }`}
                aria-hidden="true"
              >
                {action.type === "QUESTION" ? "Q" : "!"}
              </span>
              <div className="action-copy">
                <strong>
                  {action.type === "QUESTION"
                    ? action.question
                    : action.guessedPokemon?.koreanName ??
                      formatNationalDexId(
                        action.guessedPokemonNationalDexId,
                      )}
                </strong>
                {action.type === "GUESS" ? (
                  <span>포켓몬 추측</span>
                ) : action.comment ? (
                  <span className="action-comment">
                    {action.comment}
                  </span>
                ) : null}
              </div>
              <ActionOutcome action={action} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function timelineRevision(actions: readonly GameAction[]) {
  const lastAction = actions.at(-1);
  if (!lastAction) {
    return "empty";
  }
  if (lastAction.type === "GUESS") {
    return [
      actions.length,
      lastAction.sequenceNumber,
      lastAction.correct,
      lastAction.guessedPokemonNationalDexId,
    ].join(":");
  }
  return [
    actions.length,
    lastAction.sequenceNumber,
    lastAction.answer,
    lastAction.comment,
    lastAction.answeredAt,
  ].join(":");
}

function ActionOutcome({ action }: { action: GameAction }) {
  if (action.type === "GUESS") {
    return (
      <span
        className={`action-outcome ${
          action.correct ? "answer-yes" : "answer-no"
        }`}
      >
        {action.correct ? (
          <Check aria-hidden="true" size={14} />
        ) : (
          <X aria-hidden="true" size={14} />
        )}
        {action.correct ? "정답" : "오답"}
      </span>
    );
  }
  if (action.answer === null) {
    return (
      <span className="action-outcome answer-pending">
        답변 대기
      </span>
    );
  }
  const copy = {
    NO: "아니요",
    UNKNOWN: "모르겠어요",
    YES: "예",
  }[action.answer];
  const Icon =
    action.answer === "YES"
      ? Check
      : action.answer === "NO"
        ? X
        : CircleHelp;
  return (
    <span
      className={`action-outcome answer-${action.answer.toLowerCase()}`}
    >
      <Icon aria-hidden="true" size={14} />
      {copy}
    </span>
  );
}
