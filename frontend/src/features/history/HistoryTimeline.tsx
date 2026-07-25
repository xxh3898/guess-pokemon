import {
  Check,
  CircleHelp,
  CircleX,
} from "lucide-react";

import { formatNationalDexId } from "../pokemon/PokemonArtwork";
import {
  formatHistoryActionTime,
  gameAnswerLabel,
} from "./historyFormatters";
import type {
  HistoryAction,
} from "./historyTypes";

interface HistoryTimelineProps {
  actions: readonly HistoryAction[];
}

export function HistoryTimeline({
  actions,
}: HistoryTimelineProps) {
  if (actions.length === 0) {
    return (
      <div className="history-timeline-empty">
        질문이나 추측 없이 경기가 종료됐어요.
      </div>
    );
  }

  return (
    <ol className="history-timeline">
      {actions.map((action) =>
        action.type === "QUESTION" ? (
          <QuestionTimelineItem
            action={action}
            key={action.sequenceNo}
          />
        ) : (
          <GuessTimelineItem
            action={action}
            key={action.sequenceNo}
          />
        ),
      )}
    </ol>
  );
}

function QuestionTimelineItem({
  action,
}: {
  readonly action: HistoryAction;
}) {
  return (
    <li className="history-timeline-item">
      <span className="timeline-sequence">
        {String(action.sequenceNo).padStart(2, "0")}
      </span>
      <time dateTime={action.createdAt}>
        {formatHistoryActionTime(action.createdAt)}
      </time>
      <span className="timeline-marker question-marker" aria-hidden="true">
        <CircleHelp size={20} />
      </span>
      <div className="timeline-copy">
        <strong className="timeline-primary">{action.question}</strong>
        {action.comment ? (
          <p className="timeline-comment">{action.comment}</p>
        ) : null}
      </div>
      {action.answer === null ? (
        <span className="timeline-answer answer-ended">
          답변 없이 종료
        </span>
      ) : (
        <span
          className={`timeline-answer answer-${action.answer.toLowerCase()}`}
        >
          {gameAnswerLabel(action.answer)}
        </span>
      )}
    </li>
  );
}

function GuessTimelineItem({
  action,
}: {
  readonly action: HistoryAction;
}) {
  const pokemon = action.guessedPokemon;
  if (!pokemon || action.correct === null) {
    return null;
  }
  return (
    <li className="history-timeline-item">
      <span className="timeline-sequence">
        {String(action.sequenceNo).padStart(2, "0")}
      </span>
      <time dateTime={action.createdAt}>
        {formatHistoryActionTime(action.createdAt)}
      </time>
      <span
        className={`timeline-marker ${
          action.correct ? "correct-marker" : "wrong-marker"
        }`}
        aria-hidden="true"
      >
        {action.correct ? (
          <Check size={20} />
        ) : (
          <CircleX size={20} />
        )}
      </span>
      <strong className="timeline-primary">
        {formatNationalDexId(pokemon.nationalDexId)}{" "}
        {pokemon.koreanName}
      </strong>
      <span
        className={`timeline-answer ${
          action.correct ? "guess-correct" : "guess-wrong"
        }`}
      >
        {action.correct ? "정답" : "오답"}
      </span>
    </li>
  );
}
