import {
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  QuestionerActiveRoomSnapshot,
  SelectorActiveRoomSnapshot,
} from "../room/roomTypes";
import { GameScreen } from "./GameScreen";

const PIKACHU = {
  artworkEnabled: true,
  artworkUrl: "https://example.com/25.png",
  generation: 1,
  koreanName: "피카츄",
  nationalDexId: 25,
  types: ["ELECTRIC"] as const,
};

describe("GameScreen", () => {
  it("should_notRenderAnswerPokemon_when_questionerScreenOpens", () => {
    render(
      <GameScreen
        commandPending={false}
        onAnswer={vi.fn()}
        onAsk={vi.fn()}
        onOpenPokedex={vi.fn()}
        snapshot={questionerSnapshot()}
      />,
    );

    expect(screen.getByText("내 역할 · 질문자")).toBeInTheDocument();
    expect(screen.queryByText("피카츄")).not.toBeInTheDocument();
    expect(screen.queryByText("전기")).not.toBeInTheDocument();
    expect(
      document.body.innerHTML,
    ).not.toContain("https://example.com/25.png");
  });

  it("should_renderSelectedPokemonType_when_selectorScreenOpens", () => {
    render(
      <GameScreen
        commandPending={false}
        onAnswer={vi.fn()}
        onAsk={vi.fn()}
        onOpenPokedex={vi.fn()}
        snapshot={selectorSnapshot()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /피카츄/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("전기")).toBeInTheDocument();
  });

  it("should_allowPokedexBrowsing_when_questionIsWaitingForAnswer", () => {
    const base = questionerSnapshot();
    const onOpenPokedex = vi.fn();
    const snapshot: QuestionerActiveRoomSnapshot = {
      ...base,
      game: {
        ...base.game,
        actions: [pendingQuestion()],
        remainingActionCount: 19,
        usedActionCount: 1,
      },
    };

    render(
      <GameScreen
        commandPending={false}
        onAnswer={vi.fn()}
        onAsk={vi.fn()}
        onOpenPokedex={onOpenPokedex}
        snapshot={snapshot}
      />,
    );

    expect(screen.getByLabelText("질문")).toBeDisabled();
    const pokedexButton = screen.getByRole("button", {
      name: "전국도감 보기",
    });
    expect(pokedexButton).toBeEnabled();
    fireEvent.click(pokedexButton);
    expect(onOpenPokedex).toHaveBeenCalledOnce();
  });

  it("should_disablePokedexBrowsing_when_gameIsPaused", () => {
    render(
      <GameScreen
        commandPending={false}
        onAnswer={vi.fn()}
        onAsk={vi.fn()}
        onOpenPokedex={vi.fn()}
        snapshot={{
          ...questionerSnapshot(),
          status: "PAUSED",
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "전국도감 보기" }),
    ).toBeDisabled();
  });

  it("should_sendQuestion_when_enterIsPressed", () => {
    const onAsk = vi.fn();
    render(
      <GameScreen
        commandPending={false}
        onAnswer={vi.fn()}
        onAsk={onAsk}
        onOpenPokedex={vi.fn()}
        snapshot={questionerSnapshot()}
      />,
    );
    const question = screen.getByLabelText("질문");
    fireEvent.change(question, {
      target: { value: "  날개가 있나요?  " },
    });

    fireEvent.keyDown(question, { key: "Enter" });

    expect(onAsk).toHaveBeenCalledOnce();
    expect(onAsk).toHaveBeenCalledWith("날개가 있나요?");
    expect(question).toHaveValue("");
  });

  it("should_keepQuestionDraft_when_shiftEnterIsPressed", () => {
    const onAsk = vi.fn();
    render(
      <GameScreen
        commandPending={false}
        onAnswer={vi.fn()}
        onAsk={onAsk}
        onOpenPokedex={vi.fn()}
        snapshot={questionerSnapshot()}
      />,
    );
    const question = screen.getByLabelText("질문");
    fireEvent.change(question, {
      target: { value: "날개가 있나요?" },
    });

    const dispatched = fireEvent.keyDown(question, {
      key: "Enter",
      shiftKey: true,
    });

    expect(dispatched).toBe(true);
    expect(onAsk).not.toHaveBeenCalled();
    expect(question).toHaveValue("날개가 있나요?");
  });

  it("should_notSendQuestion_when_enterIsPressedDuringComposition", () => {
    const onAsk = vi.fn();
    render(
      <GameScreen
        commandPending={false}
        onAnswer={vi.fn()}
        onAsk={onAsk}
        onOpenPokedex={vi.fn()}
        snapshot={questionerSnapshot()}
      />,
    );
    const question = screen.getByLabelText("질문");
    fireEvent.change(question, {
      target: { value: "날개가 있나요?" },
    });

    const dispatched = fireEvent.keyDown(question, {
      isComposing: true,
      key: "Enter",
    });

    expect(dispatched).toBe(true);
    expect(onAsk).not.toHaveBeenCalled();
    expect(question).toHaveValue("날개가 있나요?");
  });

  it("should_sendSelectedAnswer_when_selectorHasPendingQuestion", () => {
    const onAnswer = vi.fn();
    const base = selectorSnapshot();
    const snapshot: SelectorActiveRoomSnapshot = {
      ...base,
      game: {
        ...base.game,
        actions: [pendingQuestion()],
        remainingActionCount: 19,
        usedActionCount: 1,
      },
    };

    render(
      <GameScreen
        commandPending={false}
        onAnswer={onAnswer}
        onAsk={vi.fn()}
        onOpenPokedex={vi.fn()}
        snapshot={snapshot}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "아니요" }));

    expect(onAnswer).toHaveBeenCalledWith("NO");
  });
});

function questionerSnapshot(): QuestionerActiveRoomSnapshot {
  return {
    game: {
      actions: [],
      gameId: "3f249b3c-f0a6-4054-8bcf-e6284eec5f3e",
      remainingActionCount: 20,
      status: "IN_PROGRESS",
      usedActionCount: 0,
    },
    me: {
      connected: true,
      nickname: "그린",
      reconnectDeadline: null,
      role: "QUESTIONER",
      userId: "70226fe2-cdee-4261-a3cb-fbd87a4df783",
    },
    opponent: {
      connected: true,
      nickname: "레드",
      reconnectDeadline: null,
      role: "SELECTOR",
      userId: "624f7d62-e328-4ff0-8b90-f6520b81a47f",
    },
    rematch: null,
    roomCode: "AB3K7M",
    roundNumber: 1,
    stateVersion: 3,
    status: "PLAYING",
  };
}

function selectorSnapshot(): SelectorActiveRoomSnapshot {
  const questioner = questionerSnapshot();
  return {
    ...questioner,
    game: {
      ...questioner.game,
      selectedPokemon: PIKACHU,
    },
    me: {
      ...questioner.opponent,
    },
    opponent: {
      ...questioner.me,
    },
  };
}

function pendingQuestion() {
  return {
    answer: null,
    answeredAt: null,
    createdAt: "2026-07-25T03:00:00Z",
    question: "날개가 있나요?",
    sequenceNumber: 1,
    type: "QUESTION" as const,
  };
}
