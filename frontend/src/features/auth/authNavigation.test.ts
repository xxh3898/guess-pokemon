import { describe, expect, it } from "vitest";

import {
  currentLocationPath,
  safeReturnPath,
} from "./authNavigation";

describe("authNavigation", () => {
  it("should_joinPathQueryAndHash_when_locationIsProtected", () => {
    expect(
      currentLocationPath({
        hash: "#latest",
        pathname: "/history",
        search: "?page=2",
      }),
    ).toBe("/history?page=2#latest");
  });

  it("should_acceptInternalUrl_when_returnPathIsSafe", () => {
    expect(
      safeReturnPath({ from: "/history?page=2#latest" }),
    ).toBe("/history?page=2#latest");
  });

  it("should_rejectExternalUrl_when_returnPathIsProtocolRelative", () => {
    expect(safeReturnPath({ from: "//example.com/login" })).toBeNull();
    expect(
      safeReturnPath({ from: "https://example.com/login" }),
    ).toBeNull();
  });
});
