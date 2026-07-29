import {
  CircleCheck,
  ClipboardPenLine,
  Clock3,
  MessagesSquare,
  ScanSearch,
  Shuffle,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";

import type {
  GameMode,
  RoleSelectionState,
  RoomMember,
  RoomRole,
} from "./roomTypes";

interface RolePreferencePanelProps {
  commandPending: boolean;
  connected: boolean;
  mode?: GameMode;
  me: RoomMember;
  onSelect(role: RoomRole): void;
  opponent: RoomMember;
  selection: RoleSelectionState;
  title: string;
}

export function RolePreferencePanel({
  commandPending,
  connected,
  mode = "TWENTY_QUESTIONS",
  me,
  onSelect,
  opponent,
  selection,
  title,
}: RolePreferencePanelProps) {
  return (
    <section className="role-preference-panel panel-card">
      <header>
        <span className="role-preference-heading-icon" aria-hidden="true">
          <Clock3 size={23} />
        </span>
        <div>
          <h2>{title}</h2>
          <p>
            서로 다르게 고르면 원하는 역할로 시작하고, 같으면
            무작위로 정해요.
          </p>
        </div>
      </header>

      <div className="role-preference-members">
        <RoleSelectionMember
          label="나"
          member={me}
          status={
            selection.preferredRole
              ? `내 선택 · ${roleLabel(selection.preferredRole, mode)}`
              : "역할을 골라 주세요."
          }
          tone="blue"
        />
        <RoleSelectionMember
          label="상대"
          member={opponent}
          status={
            selection.opponentSelected
              ? "상대는 역할 선택을 마쳤어요."
              : "상대가 역할을 고르고 있어요."
          }
          tone="mint"
        />
      </div>

      <div className="role-preference-options">
        <RolePreferenceButton
          disabled={
            !connected ||
            commandPending ||
            selection.preferredRole === "SELECTOR"
          }
          icon={<ClipboardPenLine aria-hidden="true" size={30} />}
          label={
            mode === "SILHOUETTE"
              ? "포켓몬을 정하기"
              : "포켓몬을 정하고 답하기"
          }
          onClick={() => {
            onSelect("SELECTOR");
          }}
          pressed={selection.preferredRole === "SELECTOR"}
          roleLabel="출제자"
          tone="selector"
        />
        <RolePreferenceButton
          disabled={
            !connected ||
            commandPending ||
            selection.preferredRole === "QUESTIONER"
          }
          icon={
            mode === "SILHOUETTE" ? (
              <ScanSearch aria-hidden="true" size={30} />
            ) : (
              <MessagesSquare aria-hidden="true" size={30} />
            )
          }
          label={
            mode === "SILHOUETTE"
              ? "실루엣 보고 맞히기"
              : "질문하고 맞히기"
          }
          onClick={() => {
            onSelect("QUESTIONER");
          }}
          pressed={selection.preferredRole === "QUESTIONER"}
          roleLabel={mode === "SILHOUETTE" ? "도전자" : "질문자"}
          tone="questioner"
        />
      </div>

      <div className="role-preference-note" role="status">
        {!connected ? (
          <>
            <Clock3 aria-hidden="true" size={17} />
            두 참가자의 실시간 연결을 확인한 뒤 선택할 수 있어요.
          </>
        ) : commandPending ? (
          <>
            <Clock3 aria-hidden="true" size={17} />
            역할 선택을 전달하고 있어요.
          </>
        ) : selection.opponentSelected ? (
          <>
            <CircleCheck aria-hidden="true" size={17} />
            상대는 역할 선택을 마쳤어요. 내 선택을 정하면 바로
            배정해요.
          </>
        ) : selection.preferredRole ? (
          <>
            <Clock3 aria-hidden="true" size={17} />
            상대가 고르는 동안 내 선택을 바꿀 수 있어요.
          </>
        ) : (
          <>
            <Shuffle aria-hidden="true" size={17} />
            두 사람이 같은 역할을 고르면 서버가 무작위로 정해요.
          </>
        )}
      </div>
    </section>
  );
}

function RoleSelectionMember({
  label,
  member,
  status,
  tone,
}: {
  label: string;
  member: RoomMember;
  status: string;
  tone: "blue" | "mint";
}) {
  return (
    <article className={`role-selection-member is-${tone}`}>
      <UserRound aria-hidden="true" size={34} />
      <div>
        <span>{label}</span>
        <strong>{member.nickname}</strong>
        <small>{status}</small>
      </div>
    </article>
  );
}

function RolePreferenceButton({
  disabled,
  icon,
  label,
  onClick,
  pressed,
  roleLabel: labelForRole,
  tone,
}: {
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick(): void;
  pressed: boolean;
  roleLabel: string;
  tone: "questioner" | "selector";
}) {
  return (
    <button
      aria-pressed={pressed}
      className={`role-preference-option is-${tone}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span>{icon}</span>
      <strong>{label}</strong>
      <small>{labelForRole}</small>
      {pressed ? (
        <CircleCheck
          aria-hidden="true"
          className="role-preference-check"
          size={21}
        />
      ) : null}
    </button>
  );
}

function roleLabel(role: RoomRole, mode: GameMode): string {
  if (role === "SELECTOR") {
    return "출제자";
  }
  return mode === "SILHOUETTE" ? "도전자" : "질문자";
}
