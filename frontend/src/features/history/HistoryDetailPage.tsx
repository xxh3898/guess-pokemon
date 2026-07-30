import {
  ArrowLeft,
  CalendarDays,
  CircleHelp,
  Flag,
  List,
  RefreshCw,
  Trophy,
  UserRound,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Link,
  useLocation,
  useParams,
} from "react-router";

import { useAuth } from "../auth/AuthContext";
import {
  formatNationalDexId,
  PokemonArtwork,
} from "../pokemon/PokemonArtwork";
import { ApiError } from "../../shared/api/HttpClient";
import { PageStatus } from "../../shared/ui/PageStatus";
import {
  type GameHistoryGateway,
  gameHistoryGateway,
} from "./historyApi";
import {
  formatHistoryDetailDate,
  gameEndReasonLabel,
  gameResultLabel,
  gameRoleLabel,
} from "./historyFormatters";
import { HistoryTimeline } from "./HistoryTimeline";
import type {
  HistoryDetail,
  HistoryParticipant,
} from "./historyTypes";

interface HistoryDetailPageProps {
  gateway?: GameHistoryGateway;
}

export function HistoryDetailPage({
  gateway = gameHistoryGateway,
}: HistoryDetailPageProps) {
  const auth = useAuth();
  const location = useLocation();
  const { gameId = "" } = useParams();
  const backPath = useMemo(
    () => historyBackPath(location.state),
    [location.state],
  );
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setError(null);
    void gateway
      .findDetail(gameId, controller.signal)
      .then(setDetail)
      .catch((caught: unknown) => {
        if (!isAbortError(caught)) {
          setError(
            caught instanceof ApiError
              ? caught
              : ApiError.invalidResponse(),
          );
        }
      });
    return () => {
      controller.abort();
    };
  }, [gameId, gateway, requestVersion]);

  if (!auth.currentUser) {
    return (
      <PageStatus
        detail="사용자 정보를 다시 확인해 주세요."
        onRetry={() => {
          void auth.restoreSession();
        }}
        title="경기 기록을 불러오지 못했어요"
      />
    );
  }

  const currentParticipant = detail?.participants.find(
    ({ userId }) => userId === auth.currentUser?.user.id,
  );

  return (
    <main className="site-page">
      <div className="site-frame history-detail-frame">
        <header className="history-detail-header">
          <Link to={backPath}>
            <ArrowLeft aria-hidden="true" size={21} />
            목록으로
          </Link>
          <h1>경기 상세</h1>
          <span aria-hidden="true" />
        </header>

        {error ? (
          <HistoryDetailError
            backPath={backPath}
            error={error}
            onRetry={() => {
              setRequestVersion((version) => version + 1);
            }}
          />
        ) : detail === null ? (
          <HistoryDetailLoading />
        ) : currentParticipant === undefined ? (
          <HistoryDetailError
            backPath={backPath}
            error={ApiError.invalidResponse()}
            onRetry={() => {
              setRequestVersion((version) => version + 1);
            }}
          />
        ) : (
          <HistoryDetailContent
            currentParticipant={currentParticipant}
            detail={detail}
          />
        )}
      </div>
    </main>
  );
}

function HistoryDetailContent({
  currentParticipant,
  detail,
}: {
  readonly currentParticipant: HistoryParticipant;
  readonly detail: HistoryDetail;
}) {
  return (
    <div className="history-detail-content">
      <section
        aria-label="경기 요약"
        className="history-detail-summary"
      >
        <article className="history-answer-card">
          <span className={`history-mode-badge mode-${(detail.mode ?? "TWENTY_QUESTIONS").toLowerCase()}`}>
            {detail.mode === "SILHOUETTE"
              ? "실루엣 퀴즈"
              : "스무고개"}
          </span>
          <span className="history-answer-number">
            {formatNationalDexId(
              detail.answerPokemon.nationalDexId,
            )}
          </span>
          <h2>{detail.answerPokemon.koreanName}</h2>
          <PokemonArtwork
            className="history-detail-artwork"
            pokemon={detail.answerPokemon}
          />
        </article>

        <article className="history-result-summary">
          <div
            className={`history-detail-result result-${currentParticipant.result.toLowerCase()}`}
          >
            <Trophy aria-hidden="true" size={22} />
            {gameResultLabel(currentParticipant.result)}
          </div>
          <dl>
            <div>
              <dt>
                <CalendarDays aria-hidden="true" size={19} />
                플레이 날짜
              </dt>
              <dd>
                <time dateTime={detail.startedAt}>
                  {formatHistoryDetailDate(detail.startedAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt>
                <CircleHelp aria-hidden="true" size={19} />
                사용한 기회
              </dt>
              <dd>
                {detail.actionCount} /{" "}
                {detail.mode === "SILHOUETTE" ? 3 : 20}
              </dd>
            </div>
            <div>
              <dt>
                <Flag aria-hidden="true" size={19} />
                종료 사유
              </dt>
              <dd>{gameEndReasonLabel(detail.endReason)}</dd>
            </div>
          </dl>
        </article>

        <article className="history-participants-card">
          <h2>참가자</h2>
          <div className="history-participant-list">
            {detail.participants.map((participant) => (
              <ParticipantCard
                key={participant.userId}
                mode={detail.mode}
                participant={participant}
              />
            ))}
          </div>
        </article>
      </section>

      {detail.status === "ABORTED" ? (
        <div className="history-aborted-notice">
          <CircleHelp aria-hidden="true" size={18} />
          승패를 정하지 못한 채 경기가 중단됐어요.
        </div>
      ) : null}

      <section
        aria-labelledby="history-timeline-title"
        className="history-timeline-section"
      >
        <h2 id="history-timeline-title">진행 기록</h2>
        <HistoryTimeline actions={detail.actions} />
      </section>
    </div>
  );
}

function ParticipantCard({
  mode,
  participant,
}: {
  readonly mode: NonNullable<HistoryDetail["mode"]> | undefined;
  readonly participant: HistoryParticipant;
}) {
  return (
    <div className="history-participant">
      <span
        className={`participant-avatar role-${participant.role.toLowerCase()}`}
        aria-hidden="true"
      >
        <UserRound size={22} />
      </span>
      <strong>{participant.nickname}</strong>
      <span
        className={`history-role-badge role-${participant.role.toLowerCase()}`}
      >
        {gameRoleLabel(participant.role, mode)}
      </span>
      <span
        className={`participant-result result-${participant.result.toLowerCase()}`}
      >
        {gameResultLabel(participant.result)}
      </span>
    </div>
  );
}

function HistoryDetailLoading() {
  return (
    <div
      aria-label="경기 상세를 불러오는 중"
      aria-live="polite"
      className="history-detail-loading"
      role="status"
    >
      <div aria-hidden="true" />
      <div aria-hidden="true" />
      <div aria-hidden="true" />
      <div aria-hidden="true" />
    </div>
  );
}

function HistoryDetailError({
  backPath,
  error,
  onRetry,
}: {
  readonly backPath: string;
  readonly error: ApiError;
  readonly onRetry: () => void;
}) {
  const notFound =
    error.code === "GAME_NOT_FOUND" || error.status === 404;
  return (
    <div className="history-state-card history-detail-state" role="alert">
      <span className="history-state-icon" aria-hidden="true">
        {notFound ? <List size={36} /> : <CircleHelp size={36} />}
      </span>
      <h2>
        {notFound
          ? "경기 기록을 찾을 수 없어요"
          : "경기 상세를 불러오지 못했어요"}
      </h2>
      <p>
        {notFound
          ? "삭제됐거나 참여하지 않은 경기일 수 있어요."
          : error.detail}
      </p>
      <div className="history-state-actions">
        {!notFound ? (
          <button
            className="primary-button compact-button"
            onClick={onRetry}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={18} />
            다시 시도
          </button>
        ) : null}
        <Link className="secondary-link compact-link" to={backPath}>
          <List aria-hidden="true" size={18} />
          목록으로
        </Link>
      </div>
    </div>
  );
}

function historyBackPath(state: unknown): string {
  if (
    typeof state !== "object" ||
    state === null ||
    !("historySearch" in state) ||
    typeof state.historySearch !== "string" ||
    !state.historySearch.startsWith("?")
  ) {
    return "/history";
  }
  const search = new URLSearchParams(
    state.historySearch.slice(1),
  );
  if (
    Array.from(search.keys()).some(
      (key) => key !== "result" && key !== "page",
    ) ||
    search.getAll("result").length > 1 ||
    search.getAll("page").length > 1
  ) {
    return "/history";
  }
  const result = search.get("result");
  const page = search.get("page");
  if (
    (result !== null &&
      result !== "WIN" &&
      result !== "LOSS" &&
      result !== "NONE") ||
    (page !== null && !/^[1-9]\d*$/.test(page))
  ) {
    return "/history";
  }
  const safeSearch = new URLSearchParams();
  if (result !== null) {
    safeSearch.set("result", result);
  }
  if (page !== null) {
    safeSearch.set("page", page);
  }
  const value = safeSearch.toString();
  return value.length > 0 ? `/history?${value}` : "/history";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
