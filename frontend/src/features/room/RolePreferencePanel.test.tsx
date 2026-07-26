import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  RoleSelectionState,
  RoomMember,
} from "./roomTypes";
import { RolePreferencePanel } from "./RolePreferencePanel";

const ME: RoomMember = {
  connected: true,
  nickname: "레드",
  reconnectDeadline: null,
  role: null,
  userId: "624f7d62-e328-4ff0-8b90-f6520b81a47f",
};

const OPPONENT: RoomMember = {
  connected: true,
  nickname: "그린",
  reconnectDeadline: null,
  role: null,
  userId: "70226fe2-cdee-4261-a3cb-fbd87a4df783",
};

const EMPTY_SELECTION: RoleSelectionState = {
  opponentSelected: false,
  preferredRole: null,
};

describe("RolePreferencePanel", () => {
  it("should_submitSelectedRole_when_playerChoosesPreference", () => {
    const onSelect = vi.fn();
    render(
      <RolePreferencePanel
        commandPending={false}
        connected
        me={ME}
        onSelect={onSelect}
        opponent={OPPONENT}
        selection={EMPTY_SELECTION}
        title="역할 선택 중"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /포켓몬을 정하고 답하기/,
      }),
    );

    expect(onSelect).toHaveBeenCalledWith("SELECTOR");
  });

  it("should_showOnlyOpponentCompletion_when_opponentAlreadySelected", () => {
    render(
      <RolePreferencePanel
        commandPending={false}
        connected
        me={ME}
        onSelect={vi.fn()}
        opponent={OPPONENT}
        selection={{
          opponentSelected: true,
          preferredRole: "QUESTIONER",
        }}
        title="역할 선택 중"
      />,
    );

    expect(
      screen.getByText("상대는 역할 선택을 마쳤어요."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /질문하고 맞히기/,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("상대 선택 · 출제자")).not.toBeInTheDocument();
    expect(screen.queryByText("상대 선택 · 질문자")).not.toBeInTheDocument();
  });

  it("should_disableRoleButtons_when_opponentIsDisconnected", () => {
    render(
      <RolePreferencePanel
        commandPending={false}
        connected={false}
        me={ME}
        onSelect={vi.fn()}
        opponent={{
          ...OPPONENT,
          connected: false,
        }}
        selection={EMPTY_SELECTION}
        title="역할 선택 중"
      />,
    );

    expect(
      screen.getByRole("button", {
        name: /포켓몬을 정하고 답하기/,
      }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "두 참가자의 실시간 연결을 확인한 뒤 선택할 수 있어요.",
      ),
    ).toBeInTheDocument();
  });
});
