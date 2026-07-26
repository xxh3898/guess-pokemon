import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GameAction } from "../room/roomTypes";
import { GameActionTimeline } from "./GameActionTimeline";

const PIKACHU = {
  artworkEnabled: true,
  artworkUrl: "https://example.test/25.png",
  generation: 1,
  koreanName: "피카츄",
  nationalDexId: 25,
  types: ["ELECTRIC"] as const,
};

const ACTIONS: readonly GameAction[] = [
  {
    answer: "NO",
    answeredAt: "2026-07-26T01:00:03Z",
    comment: null,
    createdAt: "2026-07-26T01:00:00Z",
    question: "날개가 있나요?",
    sequenceNumber: 1,
    type: "QUESTION",
  },
  {
    correct: false,
    createdAt: "2026-07-26T01:01:00Z",
    guessedPokemon: {
      ...PIKACHU,
      koreanName: "라이츄",
      nationalDexId: 26,
    },
    guessedPokemonNationalDexId: 26,
    sequenceNumber: 2,
    type: "GUESS",
  },
  {
    correct: true,
    createdAt: "2026-07-26T01:02:00Z",
    guessedPokemon: PIKACHU,
    guessedPokemonNationalDexId: 25,
    sequenceNumber: 3,
    type: "GUESS",
  },
];

describe("GameActionTimeline", () => {
  it("should_distinguishGuessMarkers_when_resultsDiffer", () => {
    render(<GameActionTimeline actions={ACTIONS} />);
    const items = screen.getAllByRole("listitem");
    const wrongMarker = items[1]?.querySelector(".action-kind");
    const correctMarker = items[2]?.querySelector(".action-kind");

    expect(wrongMarker).toHaveClass("is-guess");
    expect(wrongMarker).not.toHaveClass("is-correct");
    expect(correctMarker).toHaveClass(
      "is-guess",
      "is-correct",
    );
    expect(
      within(items[1] as HTMLElement).getByText("오답"),
    ).toBeInTheDocument();
    expect(
      within(items[2] as HTMLElement).getByText("정답"),
    ).toBeInTheDocument();
  });

  it("should_keepQuestionMarkerUnchanged_when_questionIsRendered", () => {
    render(<GameActionTimeline actions={ACTIONS} />);
    const questionMarker = screen
      .getAllByRole("listitem")[0]
      ?.querySelector(".action-kind");

    expect(questionMarker).toHaveTextContent("Q");
    expect(questionMarker).not.toHaveClass(
      "is-guess",
      "is-correct",
    );
  });

  it("should_displayOnlyPokemonName_when_guessIsRendered", () => {
    render(<GameActionTimeline actions={ACTIONS} />);
    const timeline = screen.getByRole("list", {
      name: "질문과 답변 기록 목록",
    });

    expect(within(timeline).getByText("라이츄")).toBeInTheDocument();
    expect(within(timeline).getByText("피카츄")).toBeInTheDocument();
    expect(within(timeline).queryByText("No.0026")).not.toBeInTheDocument();
    expect(within(timeline).queryByText("No.0025")).not.toBeInTheDocument();
  });

  it("should_displayFriendlyFallbackWithoutNumber_when_guessSummaryIsMissing", () => {
    const actionWithoutSummary: GameAction = {
      correct: false,
      createdAt: "2026-07-26T01:01:00Z",
      guessedPokemon: null,
      guessedPokemonNationalDexId: 26,
      sequenceNumber: 1,
      type: "GUESS",
    };

    render(
      <GameActionTimeline actions={[actionWithoutSummary]} />,
    );

    expect(
      screen.getByText("포켓몬 이름을 확인할 수 없어요"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No.0026")).not.toBeInTheDocument();
  });

  it("should_followLatestAction_when_readerWasAtTimelineEnd", () => {
    const { rerender } = render(
      <GameActionTimeline actions={ACTIONS.slice(0, 2)} />,
    );
    const list = screen.getByRole("list", {
      name: "질문과 답변 기록 목록",
    });
    let scrollHeight = 200;
    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    list.scrollTop = 100;
    fireEvent.scroll(list);

    scrollHeight = 300;
    rerender(<GameActionTimeline actions={ACTIONS} />);

    expect(list.scrollTop).toBe(300);
  });

  it("should_preserveReaderPosition_when_olderActionsAreBeingRead", () => {
    const { rerender } = render(
      <GameActionTimeline actions={ACTIONS.slice(0, 2)} />,
    );
    const list = screen.getByRole("list", {
      name: "질문과 답변 기록 목록",
    });
    let scrollHeight = 200;
    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    list.scrollTop = 20;
    fireEvent.scroll(list);

    scrollHeight = 300;
    rerender(<GameActionTimeline actions={ACTIONS} />);

    expect(list.scrollTop).toBe(20);
  });
});
