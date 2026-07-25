import {
  Clock3,
  DoorOpen,
  LockKeyhole,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ActiveRoomSnapshot } from "../room/roomTypes";
import { Modal } from "../../shared/ui/Modal";

interface GameInterruptionDialogsProps {
  leaveOpen: boolean;
  leaving: boolean;
  logoutOpen: boolean;
  onCancelLeave(): void;
  onCancelLogout(): void;
  onConfirmLeave(): void;
  snapshot: ActiveRoomSnapshot;
}

export function GameInterruptionDialogs({
  leaveOpen,
  leaving,
  logoutOpen,
  onCancelLeave,
  onCancelLogout,
  onConfirmLeave,
  snapshot,
}: GameInterruptionDialogsProps) {
  const disconnectedMember = useMemo(
    () =>
      !snapshot.me.connected
        ? snapshot.me
        : !snapshot.opponent.connected
          ? snapshot.opponent
          : null,
    [snapshot.me, snapshot.opponent],
  );
  const remainingSeconds = useRemainingSeconds(
    disconnectedMember?.reconnectDeadline ?? null,
  );

  if (snapshot.status === "PAUSED" && disconnectedMember) {
    return (
      <Modal className="interruption-modal" title="상대 연결이 끊겼어요">
        <Clock3
          aria-hidden="true"
          className="interruption-icon warning-icon"
          size={42}
        />
        <strong className="reconnect-countdown">
          {formatCountdown(remainingSeconds)}
        </strong>
        <p>
          60초 동안 재접속을 기다립니다. 시간이 끝나도 서버의
          최종 결과가 올 때까지 잠시 기다려 주세요.
        </p>
        <div className="connection-state-list">
          <span>
            {snapshot.me.nickname} (나)
            <strong>
              {snapshot.me.connected ? "연결됨" : "연결 끊김"}
            </strong>
          </span>
          <span>
            {snapshot.opponent.nickname} (상대)
            <strong>
              {snapshot.opponent.connected
                ? "연결됨"
                : "연결 끊김"}
            </strong>
          </span>
        </div>
      </Modal>
    );
  }

  if (logoutOpen) {
    return (
      <Modal
        className="interruption-modal"
        onClose={onCancelLogout}
        title="진행 중인 게임이 있어요"
      >
        <LockKeyhole
          aria-hidden="true"
          className="interruption-icon danger-icon"
          size={42}
        />
        <p>로그아웃하려면 먼저 게임에서 나가야 합니다.</p>
        <div className="modal-actions">
          <button
            className="secondary-game-button"
            onClick={onCancelLogout}
            type="button"
          >
            게임으로 돌아가기
          </button>
          <button
            className="danger-game-button"
            disabled={leaving}
            onClick={onConfirmLeave}
            type="button"
          >
            게임 나가기
          </button>
        </div>
      </Modal>
    );
  }

  if (leaveOpen) {
    return (
      <Modal
        className="interruption-modal"
        onClose={onCancelLeave}
        title="게임에서 나갈까요?"
      >
        <DoorOpen
          aria-hidden="true"
          className="interruption-icon danger-icon"
          size={42}
        />
        <p className="danger-copy">
          지금 나가면 즉시 기권 패배로 기록됩니다.
        </p>
        <div className="modal-actions">
          <button
            className="secondary-game-button"
            onClick={onCancelLeave}
            type="button"
          >
            계속하기
          </button>
          <button
            className="danger-game-button"
            disabled={leaving}
            onClick={onConfirmLeave}
            type="button"
          >
            {leaving ? "나가는 중..." : "게임 나가기"}
          </button>
        </div>
      </Modal>
    );
  }

  return null;
}

function useRemainingSeconds(deadline: string | null): number {
  const calculate = () => {
    if (!deadline) {
      return 60;
    }
    return Math.max(
      0,
      Math.ceil((Date.parse(deadline) - Date.now()) / 1_000),
    );
  };
  const [remaining, setRemaining] = useState(calculate);

  useEffect(() => {
    setRemaining(calculate());
    if (!deadline) {
      return;
    }
    const timer = globalThis.setInterval(() => {
      setRemaining(calculate());
    }, 1_000);
    return () => {
      globalThis.clearInterval(timer);
    };
  }, [deadline]);

  return remaining;
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(
    remainder,
  ).padStart(2, "0")}`;
}
