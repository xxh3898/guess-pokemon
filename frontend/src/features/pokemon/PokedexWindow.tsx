import {
  Move,
  PanelLeft,
  PanelRight,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

const DESKTOP_MEDIA_QUERY = "(min-width: 981px)";
const WINDOW_MARGIN = 16;
const DEFAULT_WINDOW_TOP = 112;
const KEYBOARD_MOVE_STEP = 16;

interface Position {
  readonly x: number;
  readonly y: number;
}

interface DragState {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startPosition: Position;
}

interface PokedexWindowProps {
  children: ReactNode;
  footer?: ReactNode;
  onClose(): void;
  title: string;
}

export function PokedexWindow({
  children,
  footer,
  onClose,
  title,
}: PokedexWindowProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const isDesktop = useDesktopViewport();
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState<Position>({
    x: WINDOW_MARGIN,
    y: WINDOW_MARGIN,
  });

  const clampToViewport = useCallback((candidate: Position) => {
    return clampPosition(candidate, dialogRef.current);
  }, []);

  useLayoutEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.focus();
    return () => {
      previousFocus?.focus();
    };
  }, []);

  useLayoutEffect(() => {
    dragRef.current = null;
    setDragging(false);
    if (isDesktop) {
      setPosition(defaultPosition(dialogRef.current));
    }
  }, [isDesktop]);

  useEffect(() => {
    const handleResize = () => {
      dragRef.current = null;
      setDragging(false);
      if (isDesktop) {
        setPosition((current) => clampToViewport(current));
      }
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [clampToViewport, isDesktop]);

  useEffect(() => {
    if (!dragging || !isDesktop) {
      return;
    }
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      setPosition(
        clampToViewport({
          x:
            drag.startPosition.x +
            event.clientX -
            drag.startClientX,
          y:
            drag.startPosition.y +
            event.clientY -
            drag.startClientY,
        }),
      );
    };
    const finishDrag = (event: PointerEvent) => {
      if (event.pointerId !== dragRef.current?.pointerId) {
        return;
      }
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [clampToViewport, dragging, isDesktop]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const blockingModalExists = Array.from(
        document.querySelectorAll(
          '[role="dialog"][aria-modal="true"]',
        ),
      ).some((dialog) => dialog !== dialogRef.current);
      if (
        event.key !== "Escape" ||
        blockingModalExists
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const moveWithKeyboard = (
    event: ReactKeyboardEvent<HTMLElement>,
  ) => {
    if (!isDesktop || isInteractiveTarget(event.target)) {
      return;
    }
    const movement = keyboardMovement(event.key);
    if (!movement) {
      return;
    }
    event.preventDefault();
    setPosition((current) =>
      clampToViewport({
        x: current.x + movement.x,
        y: current.y + movement.y,
      }),
    );
  };

  const dock = (side: "left" | "right") => {
    const bounds = windowBounds(dialogRef.current);
    setPosition((current) => ({
      x: side === "left" ? bounds.minX : bounds.maxX,
      y: clamp(current.y, bounds.minY, bounds.maxY),
    }));
  };

  const style = isDesktop
    ? ({
        transform:
          `translate3d(${position.x}px, ${position.y}px, 0px)`,
      } satisfies CSSProperties)
    : undefined;

  return (
    <div className="pokedex-window-layer" role="presentation">
      <div
        aria-labelledby={titleId}
        aria-modal={isDesktop ? undefined : "true"}
        className={[
          "pokedex-window",
          isDesktop ? "is-desktop" : "is-mobile",
          dragging ? "is-dragging" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        ref={dialogRef}
        role="dialog"
        style={style}
        tabIndex={-1}
      >
        <header
          aria-label={
            isDesktop ? "전국도감 창 이동" : undefined
          }
          className="pokedex-window-heading"
          onKeyDown={moveWithKeyboard}
          onPointerDown={(
            event: ReactPointerEvent<HTMLElement>,
          ) => {
            if (
              !isDesktop ||
              event.button !== 0 ||
              event.pointerType === "touch" ||
              isInteractiveTarget(event.target)
            ) {
              return;
            }
            dragRef.current = {
              pointerId: event.pointerId,
              startClientX: event.clientX,
              startClientY: event.clientY,
              startPosition: position,
            };
            setDragging(true);
          }}
          role={isDesktop ? "toolbar" : undefined}
          tabIndex={isDesktop ? 0 : undefined}
        >
          <div className="pokedex-window-title">
            {isDesktop ? (
              <Move aria-hidden="true" size={18} />
            ) : null}
            <h2 id={titleId}>{title}</h2>
          </div>
          <div className="pokedex-window-actions">
            {isDesktop ? (
              <>
                <button
                  aria-label="왼쪽에 고정"
                  onClick={() => {
                    dock("left");
                  }}
                  type="button"
                >
                  <PanelLeft aria-hidden="true" size={18} />
                </button>
                <button
                  aria-label="오른쪽에 고정"
                  onClick={() => {
                    dock("right");
                  }}
                  type="button"
                >
                  <PanelRight aria-hidden="true" size={18} />
                </button>
              </>
            ) : null}
            <button
              aria-label="전국도감 닫기"
              onClick={onClose}
              type="button"
            >
              <X aria-hidden="true" size={20} />
            </button>
          </div>
        </header>
        <div className="pokedex-window-content">{children}</div>
        {footer ? (
          <footer className="pokedex-window-footer">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

function useDesktopViewport() {
  const [matches, setMatches] = useState(() =>
    desktopViewportMatches(),
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };
    setMatches(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  return matches;
}

function desktopViewportMatches() {
  return typeof window.matchMedia !== "function"
    ? true
    : window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

function defaultPosition(element: HTMLElement | null): Position {
  const bounds = windowBounds(element);
  return {
    x: bounds.minX,
    y: clamp(
      DEFAULT_WINDOW_TOP,
      bounds.minY,
      bounds.maxY,
    ),
  };
}

function clampPosition(
  candidate: Position,
  element: HTMLElement | null,
): Position {
  const bounds = windowBounds(element);
  return {
    x: clamp(candidate.x, bounds.minX, bounds.maxX),
    y: clamp(candidate.y, bounds.minY, bounds.maxY),
  };
}

function windowBounds(element: HTMLElement | null) {
  const rect = element?.getBoundingClientRect();
  const width = rect?.width ?? 0;
  const height = rect?.height ?? 0;
  return {
    maxX: Math.max(
      WINDOW_MARGIN,
      window.innerWidth - width - WINDOW_MARGIN,
    ),
    maxY: Math.max(
      WINDOW_MARGIN,
      window.innerHeight - height - WINDOW_MARGIN,
    ),
    minX: WINDOW_MARGIN,
    minY: WINDOW_MARGIN,
  };
}

function keyboardMovement(key: string): Position | null {
  switch (key) {
    case "ArrowDown":
      return { x: 0, y: KEYBOARD_MOVE_STEP };
    case "ArrowLeft":
      return { x: -KEYBOARD_MOVE_STEP, y: 0 };
    case "ArrowRight":
      return { x: KEYBOARD_MOVE_STEP, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -KEYBOARD_MOVE_STEP };
    default:
      return null;
  }
}

function isInteractiveTarget(target: EventTarget) {
  return (
    target instanceof Element &&
    target.closest("button, a, input, select, textarea") !== null
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
