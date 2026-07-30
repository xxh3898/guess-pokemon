import {
  ChevronLeft,
  ChevronRight,
  CircleCheckBig,
  CircleHelp,
  CircleX,
  Clock3,
  History,
  Play,
  RefreshCw,
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
  useSearchParams,
} from "react-router";

import { ApiError } from "../../shared/api/HttpClient";
import { AuthenticatedSiteHeader } from "../../shared/ui/AuthenticatedSiteHeader";
import {
  formatNationalDexId,
  PokemonArtwork,
} from "../pokemon/PokemonArtwork";
import {
  type GameHistoryGateway,
  gameHistoryGateway,
} from "./historyApi";
import {
  formatHistoryListDate,
  gameEndReasonLabel,
  gameResultLabel,
  gameRoleLabel,
} from "./historyFormatters";
import type {
  GameResult,
  HistoryListItem,
  HistoryPage,
} from "./historyTypes";

interface HistoryListPageProps {
  gateway?: GameHistoryGateway;
}

type ResultFilter = "ALL" | GameResult;

const FILTERS: readonly {
  label: string;
  value: ResultFilter;
}[] = [
  { label: "전체", value: "ALL" },
  { label: "승리", value: "WIN" },
  { label: "패배", value: "LOSS" },
  { label: "중단", value: "NONE" },
];

export function HistoryListPage({
  gateway = gameHistoryGateway,
}: HistoryListPageProps) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = useMemo(
    () => readHistoryQuery(searchParams),
    [searchParams],
  );
  const [historyPage, setHistoryPage] =
    useState<HistoryPage | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    if (!query.invalid) {
      return;
    }
    setSearchParams(
      historySearchParams(query.result, query.page),
      { replace: true },
    );
  }, [
    query.invalid,
    query.page,
    query.result,
    setSearchParams,
  ]);

  useEffect(() => {
    if (query.invalid) {
      return undefined;
    }
    const controller = new AbortController();
    setHistoryPage(null);
    setError(null);

    void gateway
      .list(
        {
          page: query.page,
          result:
            query.result === "ALL" ? null : query.result,
        },
        controller.signal,
      )
      .then((response) => {
        if (response.totalPages === 0 && query.page > 0) {
          setSearchParams(
            historySearchParams(query.result, 0),
            { replace: true },
          );
          return;
        }
        if (
          response.totalPages > 0 &&
          query.page >= response.totalPages
        ) {
          setSearchParams(
            historySearchParams(
              query.result,
              response.totalPages - 1,
            ),
            { replace: true },
          );
          return;
        }
        setHistoryPage(response);
      })
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
  }, [
    gateway,
    query.invalid,
    query.page,
    query.result,
    requestVersion,
    setSearchParams,
  ]);

  const selectFilter = (result: ResultFilter) => {
    setSearchParams(historySearchParams(result, 0));
  };
  const selectPage = (page: number) => {
    setSearchParams(historySearchParams(query.result, page));
  };

  return (
    <main className="site-page">
      <div className="site-frame history-frame">
        <AuthenticatedSiteHeader activePage="history" />

        <section
          aria-labelledby="history-title"
          className="history-list-content"
        >
          <div className="history-heading">
            <div>
              <p className="section-kicker">
                <History aria-hidden="true" size={18} />
                BATTLE ARCHIVE
              </p>
              <h1 id="history-title">경기 기록</h1>
              <p>
                지난 경기의 결과와 질문·추측 기록을 확인할 수
                있어요.
              </p>
            </div>
          </div>

          <div
            aria-label="경기 결과 필터"
            className="history-filters"
            role="group"
          >
            {FILTERS.map((filter) => (
              <button
                aria-pressed={query.result === filter.value}
                className={`history-filter history-filter-${filter.value.toLowerCase()}`}
                key={filter.value}
                onClick={() => {
                  selectFilter(filter.value);
                }}
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>

          {error ? (
            <HistoryErrorState
              detail={error.detail}
              onRetry={() => {
                setRequestVersion((version) => version + 1);
              }}
            />
          ) : historyPage === null ? (
            <HistoryLoadingState />
          ) : historyPage.content.length === 0 ? (
            <HistoryEmptyState filtered={query.result !== "ALL"} />
          ) : (
            <>
              <div className="history-table-heading" aria-hidden="true">
                <span>결과</span>
                <span>날짜</span>
                <span>상대방</span>
                <span>내 역할</span>
                <span>정답</span>
                <span>시도 횟수</span>
                <span>종료 사유</span>
                <span />
              </div>
              <div className="history-list">
                {historyPage.content.map((item) => (
                  <HistoryListRow
                    historySearch={location.search}
                    item={item}
                    key={item.gameId}
                  />
                ))}
              </div>
              <HistoryPagination
                currentPage={query.page}
                onSelectPage={selectPage}
                totalPages={historyPage.totalPages}
              />
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function HistoryListRow({
  historySearch,
  item,
}: {
  readonly historySearch: string;
  readonly item: HistoryListItem;
}) {
  const playedAt = formatHistoryListDate(item.endedAt);
  const resultClass = item.myResult.toLowerCase();
  const roleClass = item.myRole.toLowerCase();
  return (
    <article className="history-list-row">
      <div className="history-result-cell">
        <span
          className={`history-result-badge result-${resultClass}`}
        >
          {item.myResult === "WIN" ? (
            <CircleCheckBig aria-hidden="true" size={17} />
          ) : item.myResult === "LOSS" ? (
            <CircleX aria-hidden="true" size={17} />
          ) : (
            <CircleHelp aria-hidden="true" size={17} />
          )}
          {gameResultLabel(item.myResult)}
        </span>
        <small className={`history-mode-badge mode-${(item.mode ?? "TWENTY_QUESTIONS").toLowerCase()}`}>
          {item.mode === "SILHOUETTE"
            ? "실루엣 퀴즈"
            : "스무고개"}
        </small>
      </div>
      <time className="history-list-date" dateTime={item.endedAt}>
        <span>{playedAt.date}</span>
        <span>{playedAt.time}</span>
      </time>
      <div className="history-opponent">
        <UserRound aria-hidden="true" size={18} />
        <span>vs {item.opponent.nickname}</span>
      </div>
      <div className={`history-role-badge role-${roleClass}`}>
        <UserRound aria-hidden="true" size={17} />
        {gameRoleLabel(item.myRole, item.mode)}
      </div>
      <div className="history-answer-summary">
        <PokemonArtwork
          className="history-answer-artwork"
          pokemon={item.answerPokemon}
        />
        <span>
          <small>
            {formatNationalDexId(
              item.answerPokemon.nationalDexId,
            )}
          </small>
          <strong>{item.answerPokemon.koreanName}</strong>
        </span>
      </div>
      <strong className="history-action-count">
        {item.actionCount} / {item.mode === "SILHOUETTE" ? 3 : 20}회
      </strong>
      <span className="history-end-reason">
        {gameEndReasonLabel(item.endReason)}
      </span>
      <Link
        aria-label={`${item.opponent.nickname}님과의 경기 상세 보기`}
        className="history-detail-link"
        state={{ historySearch }}
        to={`/history/${item.gameId}`}
      >
        <ChevronRight aria-hidden="true" size={20} />
      </Link>
    </article>
  );
}

function HistoryPagination({
  currentPage,
  onSelectPage,
  totalPages,
}: {
  readonly currentPage: number;
  readonly onSelectPage: (page: number) => void;
  readonly totalPages: number;
}) {
  if (totalPages <= 1) {
    return null;
  }
  const pages = visiblePages(currentPage, totalPages);
  return (
    <nav aria-label="경기 기록 페이지" className="history-pagination">
      <button
        aria-label="이전 페이지"
        disabled={currentPage === 0}
        onClick={() => {
          onSelectPage(currentPage - 1);
        }}
        type="button"
      >
        <ChevronLeft aria-hidden="true" size={18} />
      </button>
      {pages.map((page) => (
        <button
          aria-current={page === currentPage ? "page" : undefined}
          key={page}
          onClick={() => {
            onSelectPage(page);
          }}
          type="button"
        >
          {page + 1}
        </button>
      ))}
      <button
        aria-label="다음 페이지"
        disabled={currentPage >= totalPages - 1}
        onClick={() => {
          onSelectPage(currentPage + 1);
        }}
        type="button"
      >
        <ChevronRight aria-hidden="true" size={18} />
      </button>
    </nav>
  );
}

function HistoryLoadingState() {
  return (
    <div
      aria-label="경기 기록을 불러오는 중"
      aria-live="polite"
      className="history-loading"
      role="status"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <span aria-hidden="true" key={index} />
      ))}
    </div>
  );
}

function HistoryEmptyState({
  filtered,
}: {
  readonly filtered: boolean;
}) {
  return (
    <div className="history-state-card">
      <span className="history-state-icon" aria-hidden="true">
        <History size={36} />
      </span>
      <h2>
        {filtered
          ? "조건에 맞는 경기 기록이 없어요"
          : "아직 경기 기록이 없어요"}
      </h2>
      <p>
        {filtered
          ? "다른 결과 필터를 선택해 확인해 보세요."
          : "대전을 완료하면 여기에 기록이 나타나요."}
      </p>
      <Link className="primary-link compact-link" to="/lobby">
        <Play aria-hidden="true" size={18} />
        대전 시작하기
      </Link>
    </div>
  );
}

function HistoryErrorState({
  detail,
  onRetry,
}: {
  readonly detail: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="history-state-card" role="alert">
      <span
        className="history-state-icon history-error-icon"
        aria-hidden="true"
      >
        <Clock3 size={36} />
      </span>
      <h2>경기 기록을 불러오지 못했어요</h2>
      <p>{detail}</p>
      <button
        className="primary-button compact-button"
        onClick={onRetry}
        type="button"
      >
        <RefreshCw aria-hidden="true" size={18} />
        다시 시도
      </button>
    </div>
  );
}

function readHistoryQuery(searchParams: URLSearchParams): {
  invalid: boolean;
  page: number;
  result: ResultFilter;
} {
  const resultValue = searchParams.get("result");
  const result =
    resultValue === "WIN" ||
    resultValue === "LOSS" ||
    resultValue === "NONE"
      ? resultValue
      : "ALL";
  const pageValue = searchParams.get("page");
  const parsedPage =
    pageValue !== null && /^\d+$/.test(pageValue)
      ? Number(pageValue)
      : 0;
  const page = Number.isSafeInteger(parsedPage) ? parsedPage : 0;
  const allowedKeys = new Set(["page", "result"]);
  const hasUnknownKey = Array.from(searchParams.keys()).some(
    (key) => !allowedKeys.has(key),
  );
  return {
    invalid:
      hasUnknownKey ||
      (resultValue !== null && result === "ALL") ||
      (pageValue !== null &&
        (page <= 0 || pageValue !== String(page))),
    page,
    result,
  };
}

function historySearchParams(
  result: ResultFilter,
  page: number,
): URLSearchParams {
  const search = new URLSearchParams();
  if (result !== "ALL") {
    search.set("result", result);
  }
  if (page > 0) {
    search.set("page", String(page));
  }
  return search;
}

function visiblePages(
  currentPage: number,
  totalPages: number,
): number[] {
  const first = Math.max(
    0,
    Math.min(currentPage - 2, totalPages - 5),
  );
  const last = Math.min(totalPages, first + 5);
  return Array.from(
    { length: last - first },
    (_, index) => first + index,
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
