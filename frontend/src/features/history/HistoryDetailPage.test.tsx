import {
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createMemoryRouter,
  type InitialEntry,
} from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it, vi } from "vitest";

import {
  AuthContext,
  type AuthContextValue,
} from "../auth/AuthContext";
import { ApiError } from "../../shared/api/HttpClient";
import {
  createAuthContextValue,
  TEST_CURRENT_USER,
} from "../../test/authTestUtils";
import {
  TEST_GAME_ID,
  TEST_HISTORY_DETAIL,
  TEST_HISTORY_PAGE,
} from "../../test/historyTestUtils";
import type { GameHistoryGateway } from "./historyApi";
import { HistoryDetailPage } from "./HistoryDetailPage";
import type { HistoryDetail } from "./historyTypes";

describe("HistoryDetailPage", () => {
  it("should_renderTimelineAsText_when_detailLoads", async () => {
    const { container } = renderHistoryDetail(
      historyGateway(),
      `/history/${TEST_GAME_ID}`,
    );

    expect(
      await screen.findByRole("heading", { name: "피카츄" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("승리")).toHaveLength(2);
    expect(
      screen.getByText("<script>alert('위험')</script>"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("<script>alert('코멘트')</script>"),
    ).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("No.0025 피카츄")).toBeInTheDocument();
  });

  it("should_preserveListQuery_when_openedFromFilteredPage", async () => {
    renderHistoryDetail(historyGateway(), {
      pathname: `/history/${TEST_GAME_ID}`,
      state: {
        historySearch: "?result=WIN&page=2",
      },
    });

    expect(
      await screen.findByRole("link", { name: "목록으로" }),
    ).toHaveAttribute("href", "/history?result=WIN&page=2");
  });

  it("should_showNotFoundState_when_gameIsUnavailable", async () => {
    renderHistoryDetail(
      historyGateway({
        findDetail: vi.fn().mockRejectedValue(
          new ApiError({
            code: "GAME_NOT_FOUND",
            detail: "경기 기록을 찾을 수 없습니다.",
            status: 404,
            title: "경기 기록 없음",
          }),
        ),
      }),
      `/history/${TEST_GAME_ID}`,
    );

    expect(
      await screen.findByRole("heading", {
        name: "경기 기록을 찾을 수 없어요",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "다시 시도" }),
    ).not.toBeInTheDocument();
  });

  it("should_showEndedAnswer_when_questionWasNotAnswered", async () => {
    const abortedDetail: HistoryDetail = {
      ...TEST_HISTORY_DETAIL,
      actionCount: 1,
      actions: [
        {
          answer: null,
          answeredAt: null,
          comment: null,
          correct: null,
          createdAt: "2026-07-25T05:01:00Z",
          guessedPokemon: null,
          question: "날개가 있나요?",
          sequenceNo: 1,
          type: "QUESTION",
        },
      ],
      endReason: "SERVER_RESTART",
      participants: TEST_HISTORY_DETAIL.participants.map(
        (participant) => ({
          ...participant,
          result: "NONE" as const,
        }),
      ),
      status: "ABORTED",
    };
    renderHistoryDetail(
      historyGateway({
        findDetail: vi.fn().mockResolvedValue(abortedDetail),
      }),
      `/history/${TEST_GAME_ID}`,
    );

    expect(
      await screen.findByText("답변 없이 종료"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("승패를 정하지 못한 채 경기가 중단됐어요."),
    ).toBeInTheDocument();
  });

  it("should_abortDetailRequest_when_pageUnmounts", async () => {
    let requestSignal: AbortSignal | undefined;
    const gateway = historyGateway({
      findDetail: vi.fn(
        (
          _gameId: string,
          signal?: AbortSignal,
        ): Promise<HistoryDetail> => {
          requestSignal = signal;
          return new Promise<HistoryDetail>(() => undefined);
        },
      ),
    });
    const { unmount } = renderHistoryDetail(
      gateway,
      `/history/${TEST_GAME_ID}`,
    );

    await waitFor(() => {
      expect(requestSignal).toBeDefined();
    });
    unmount();
    expect(requestSignal?.aborted).toBe(true);
  });
});

function renderHistoryDetail(
  gateway: GameHistoryGateway,
  initialEntry: InitialEntry,
  value: AuthContextValue = authenticatedContext(),
): {
  container: HTMLElement;
  router: ReturnType<typeof createMemoryRouter>;
  unmount: () => void;
} {
  const router = createMemoryRouter(
    [
      {
        element: <HistoryDetailPage gateway={gateway} />,
        path: "/history/:gameId",
      },
      {
        element: <p>목록 화면</p>,
        path: "/history",
      },
    ],
    { initialEntries: [initialEntry] },
  );
  const rendered = render(
    <AuthContext.Provider value={value}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return {
    container: rendered.container,
    router,
    unmount: rendered.unmount,
  };
}

function authenticatedContext(): AuthContextValue {
  return createAuthContextValue({
    currentUser: TEST_CURRENT_USER,
    status: "authenticated",
  });
}

function historyGateway(
  overrides: Partial<GameHistoryGateway> = {},
): GameHistoryGateway {
  return {
    findDetail: vi.fn().mockResolvedValue(TEST_HISTORY_DETAIL),
    list: vi.fn().mockResolvedValue(TEST_HISTORY_PAGE),
    ...overrides,
  };
}
