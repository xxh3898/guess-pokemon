import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryRouter } from "react-router";
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
  TEST_HISTORY_DETAIL,
  TEST_HISTORY_PAGE,
} from "../../test/historyTestUtils";
import type { GameHistoryGateway } from "./historyApi";
import { HistoryListPage } from "./HistoryListPage";

describe("HistoryListPage", () => {
  it("should_renderHistoryAndUpdateFilter_when_pageLoads", async () => {
    const gateway = historyGateway();
    const router = renderHistoryList(gateway);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "경기 기록",
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText("피카츄")).toBeInTheDocument();
    expect(screen.getByText("vs 그린")).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "그린님과의 경기 상세 보기",
      }),
    ).toHaveAttribute(
      "href",
      `/history/${TEST_HISTORY_PAGE.content[0]?.gameId}`,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "패배" }),
    );

    await waitFor(() => {
      expect(router.state.location.search).toBe("?result=LOSS");
      expect(gateway.list).toHaveBeenLastCalledWith(
        {
          page: 0,
          result: "LOSS",
        },
        expect.any(AbortSignal),
      );
    });
  });

  it("should_replaceWithLastPage_when_requestedPageIsOutOfRange", async () => {
    const list = vi.fn().mockImplementation(
      ({ page }: { page: number }) =>
        Promise.resolve(
          page === 9
            ? {
                content: [],
                page: 9,
                size: 20,
                totalElements: 21,
                totalPages: 2,
              }
            : {
                ...TEST_HISTORY_PAGE,
                page: 1,
                totalElements: 21,
                totalPages: 2,
              },
        ),
    );
    const gateway = historyGateway({ list });
    const router = renderHistoryList(
      gateway,
      "/history?page=9",
    );

    await screen.findByText("피카츄");
    expect(router.state.location.search).toBe("?page=1");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("should_updatePage_when_paginationButtonIsSelected", async () => {
    const list = vi.fn().mockImplementation(
      ({ page }: { page: number }) =>
        Promise.resolve({
          ...TEST_HISTORY_PAGE,
          page,
          totalElements: 21,
          totalPages: 2,
        }),
    );
    const router = renderHistoryList(historyGateway({ list }));

    await screen.findByText("피카츄");
    fireEvent.click(
      screen.getByRole("button", { name: "2" }),
    );

    await waitFor(() => {
      expect(router.state.location.search).toBe("?page=1");
      expect(list).toHaveBeenLastCalledWith(
        {
          page: 1,
          result: null,
        },
        expect.any(AbortSignal),
      );
    });
  });

  it("should_retryAndShowEmptyState_when_requestRecovers", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError({
          code: "NETWORK_ERROR",
          detail: "네트워크 상태를 확인해 주세요.",
          status: 0,
          title: "연결 실패",
        }),
      )
      .mockResolvedValueOnce({
        content: [],
        page: 0,
        size: 20,
        totalElements: 0,
        totalPages: 0,
      });
    renderHistoryList(historyGateway({ list }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "네트워크 상태를 확인해 주세요.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "다시 시도" }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "아직 경기 기록이 없어요",
      }),
    ).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("should_resetPage_when_emptyResultHasNoValidPage", async () => {
    const list = vi.fn().mockResolvedValue({
      content: [],
      page: 4,
      size: 20,
      totalElements: 0,
      totalPages: 0,
    });
    const router = renderHistoryList(
      historyGateway({ list }),
      "/history?page=4",
    );

    expect(
      await screen.findByRole("heading", {
        name: "아직 경기 기록이 없어요",
      }),
    ).toBeInTheDocument();
    expect(router.state.location.search).toBe("");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("should_removeDefaultPage_when_queryUsesLeadingZeros", async () => {
    const list = vi.fn().mockResolvedValue(TEST_HISTORY_PAGE);
    const router = renderHistoryList(
      historyGateway({ list }),
      "/history?page=00",
    );

    await screen.findByText("피카츄");
    expect(router.state.location.search).toBe("");
    expect(list).toHaveBeenCalledOnce();
  });
});

function renderHistoryList(
  gateway: GameHistoryGateway,
  initialEntry = "/history",
  value: AuthContextValue = authenticatedContext(),
): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter(
    [
      {
        element: <HistoryListPage gateway={gateway} />,
        path: "/history",
      },
      {
        element: <p>상세 화면</p>,
        path: "/history/:gameId",
      },
      {
        element: <p>로그인 화면</p>,
        path: "/login",
      },
    ],
    { initialEntries: [initialEntry] },
  );
  render(
    <AuthContext.Provider value={value}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return router;
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
