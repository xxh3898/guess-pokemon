import { describe, expect, it } from "vitest";

import {
  formatHistoryActionTime,
  formatHistoryDetailDate,
  formatHistoryListDate,
  gameAnswerLabel,
  gameEndReasonLabel,
  gameResultLabel,
  gameRoleLabel,
} from "./historyFormatters";

describe("historyFormatters", () => {
  it("should_formatKoreanLocalTime_when_timeZoneIsGiven", () => {
    const value = "2026-07-25T05:31:02Z";

    expect(
      formatHistoryListDate(value, {
        timeZone: "Asia/Seoul",
      }),
    ).toEqual({
      date: "2026.07.25",
      time: "14:31",
    });
    expect(
      formatHistoryDetailDate(value, {
        timeZone: "Asia/Seoul",
      }),
    ).toBe("2026.07.25 (토) 14:31");
    expect(
      formatHistoryActionTime(value, {
        timeZone: "Asia/Seoul",
      }),
    ).toBe("14:31:02");
  });

  it("should_returnUserFriendlyLabels_when_enumIsKnown", () => {
    expect(gameResultLabel("WIN")).toBe("승리");
    expect(gameRoleLabel("SELECTOR")).toBe("출제자");
    expect(gameAnswerLabel("UNKNOWN")).toBe("모르겠어요");
    expect(gameEndReasonLabel("RECONNECT_TIMEOUT")).toBe(
      "재접속 시간 초과",
    );
  });

  it("should_formatMidnightAsZeroHour_when_localTimeIsMidnight", () => {
    expect(
      formatHistoryActionTime("2026-07-24T15:00:00Z", {
        timeZone: "Asia/Seoul",
      }),
    ).toBe("00:00:00");
  });
});
