import {
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { PokedexWindow } from "./PokedexWindow";

describe("PokedexWindow", () => {
  beforeEach(() => {
    setViewport(1024, 768);
    stubDesktopViewport(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should_renderNonModalWindowAndRestoreFocus_when_desktopOpens", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(
      <PokedexWindow
        footer={<button type="button">선택 완료</button>}
        onClose={vi.fn()}
        title="전국도감"
      >
        <p>도감 내용</p>
      </PokedexWindow>,
    );

    const dialog = screen.getByRole("dialog", {
      name: "전국도감",
    });
    expect(dialog).not.toHaveAttribute("aria-modal");
    expect(document.querySelector(".modal-backdrop")).toBeNull();
    expect(dialog).toHaveFocus();
    expect(screen.getByText("선택 완료")).toBeInTheDocument();

    unmount();

    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("should_moveAndClampWindow_when_desktopControlsAct", () => {
    render(
      <PokedexWindow onClose={vi.fn()} title="전국도감">
        <p>도감 내용</p>
      </PokedexWindow>,
    );
    const dialog = screen.getByRole("dialog", {
      name: "전국도감",
    });
    mockDialogSize(dialog, 600, 500);
    fireEvent(window, new Event("resize"));
    expect(readPosition(dialog).x).toBe(16);

    fireEvent.click(
      screen.getByRole("button", { name: "왼쪽에 고정" }),
    );
    expect(readPosition(dialog).x).toBe(16);

    fireEvent.click(
      screen.getByRole("button", { name: "오른쪽에 고정" }),
    );
    expect(readPosition(dialog).x).toBe(408);

    const moveHandle = screen.getByRole("toolbar", {
      name: "전국도감 창 이동",
    });
    fireEvent.keyDown(moveHandle, { key: "ArrowLeft" });
    expect(readPosition(dialog).x).toBe(392);

    fireEvent.pointerDown(moveHandle, {
      button: 0,
      clientX: 400,
      clientY: 200,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(window, {
      clientX: -500,
      clientY: -500,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(window, {
      pointerId: 1,
      pointerType: "mouse",
    });

    expect(readPosition(dialog)).toEqual({ x: 16, y: 16 });
  });

  it("should_renderModalSheetWithoutMovementControls_when_mobileOpens", () => {
    const onClose = vi.fn();
    stubDesktopViewport(false);

    render(
      <PokedexWindow onClose={onClose} title="전국도감">
        <p>도감 내용</p>
      </PokedexWindow>,
    );

    const dialog = screen.getByRole("dialog", {
      name: "전국도감",
    });
    expect(dialog).toHaveClass("is-mobile");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.queryByRole("button", { name: "왼쪽에 고정" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("toolbar", {
        name: "전국도감 창 이동",
      }),
    ).not.toBeInTheDocument();
    expect(dialog.style.transform).toBe("");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("should_closeWindow_when_escapePressedWithoutBlockingModal", () => {
    const onClose = vi.fn();
    render(
      <PokedexWindow onClose={onClose} title="전국도감">
        <p>도감 내용</p>
      </PokedexWindow>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("should_keepWindowOpen_when_blockingModalIsActive", () => {
    const onClose = vi.fn();
    render(
      <PokedexWindow onClose={onClose} title="전국도감">
        <div aria-modal="true" role="dialog">
          추측 확인
        </div>
      </PokedexWindow>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });
});

function stubDesktopViewport(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches,
      media: "(min-width: 981px)",
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    }),
  );
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

function mockDialogSize(
  dialog: HTMLElement,
  width: number,
  height: number,
) {
  vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
    bottom: height,
    height,
    left: 0,
    right: width,
    toJSON: () => ({}),
    top: 0,
    width,
    x: 0,
    y: 0,
  });
}

function readPosition(dialog: HTMLElement) {
  const match = dialog.style.transform.match(
    /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0px\)/,
  );
  if (!match) {
    throw new Error("전국도감 창 좌표를 찾지 못했습니다.");
  }
  return {
    x: Number(match[1]),
    y: Number(match[2]),
  };
}
