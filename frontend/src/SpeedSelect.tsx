import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { t } from "./i18n";
import type { PlayerConfig } from "@aside/engine/player";

const presets = [
  { value: 0.75, hint: "慢一点，适合外语" },
  { value: 1, hint: "原速" },
  { value: 1.25, hint: "稍快一点" },
  { value: 1.5, hint: "快速过一遍" },
] as const;

export function SpeedSelect({
  config,
  onChange,
}: {
  config: PlayerConfig;
  onChange: (rate: number) => void;
}) {
  const rate = config.playbackRate;
  const rates = [
    ...new Set([
      0.5,
      0.75,
      1,
      1.25,
      1.5,
      1.75,
      2,
      config.minRate,
      config.maxRate,
      rate,
    ]),
  ]
    .filter((value) => value >= config.minRate && value <= config.maxRate)
    .sort((a, b) => a - b)
    .map((value) => ({
      value,
      hint: presets.find((item) => item.value === value)?.hint,
    }));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const selectedIndex = rates.findIndex((item) => item.value === rate);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[selectedIndex]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open, selectedIndex]);

  const select = (value: number) => {
    onChange(value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent) => {
    const index = optionRefs.current.indexOf(
      document.activeElement as HTMLLIElement,
    );
    if (event.key === "ArrowDown") {
      event.preventDefault();
      optionRefs.current[(index + 1) % rates.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      optionRefs.current[(index - 1 + rates.length) % rates.length]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className={`speed-select${open ? " open" : ""}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="speed-select-trigger btn btn-quiet btn-sm"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("播放速度")}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{rate}×</span>
        <svg
          className="speed-select-caret"
          viewBox="0 0 10 6"
          aria-hidden="true"
        >
          <path
            d="M1 1l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <ul
          className="speed-select-menu menu"
          role="listbox"
          aria-label={t("播放速度")}
          onKeyDown={onMenuKeyDown}
        >
          <li className="menu-label" role="presentation" aria-hidden="true">
            {t("播放速度")}
          </li>
          {rates.map(({ value, hint }, index) => (
            <li
              key={value}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              role="option"
              aria-selected={value === rate}
              tabIndex={-1}
              className="speed-select-option menu-option"
              onClick={() => select(value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  select(value);
                }
              }}
            >
              <span className="menu-option-text">
                <b>{value}×</b>
                {hint && <small>{t(hint)}</small>}
              </span>
              <svg
                className="menu-check"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m3 7.5 2.5 2.5L11 4.5" />
              </svg>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
