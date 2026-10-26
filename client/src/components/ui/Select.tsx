import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/ui";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function Select(props: {
  label: string;
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}): JSX.Element {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const selected = props.options.find((option) => option.value === props.value);
  const expanded = open && !props.disabled;

  useEffect(() => {
    if (!expanded) return;
    function dismiss(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded]);

  useLayoutEffect(() => {
    if (!expanded) return;
    function placeMenu(): void {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const opensAbove = below < Math.min(224, props.options.length * 36 + 12) && above > below;
      setPosition({
        left: rect.left,
        width: rect.width,
        maxHeight: Math.max(36, Math.min(224, opensAbove ? above : below)),
        ...(opensAbove ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      });
    }
    placeMenu();
    window.addEventListener("resize", placeMenu);
    document.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      document.removeEventListener("scroll", placeMenu, true);
    };
  }, [expanded, props.options.length]);

  useEffect(() => {
    if (expanded) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, expanded, id]);

  function show(): void {
    const selectedIndex = props.options.findIndex((option) => option.value === props.value && !option.disabled);
    setActiveIndex(selectedIndex < 0 ? props.options.findIndex((option) => !option.disabled) : selectedIndex);
    setOpen(true);
  }

  function choose(index: number): void {
    const option = props.options[index];
    if (!option || option.disabled) return;
    if (option.value !== props.value) props.onValueChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (expanded) choose(activeIndex);
      else show();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const enabled = props.options.flatMap((option, index) => option.disabled ? [] : [index]);
      if (!enabled.length) return;
      const current = enabled.indexOf(activeIndex);
      const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
        : !expanded ? (event.key === "ArrowUp" ? enabled.length - 1 : 0)
          : (current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
      setActiveIndex(enabled[next]);
      setOpen(true);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const text = (now - searchRef.current.time < 700 ? searchRef.current.text : "") + event.key.toLocaleLowerCase();
      searchRef.current = { text, time: now };
      const index = props.options.findIndex((option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(text));
      if (index >= 0) {
        setActiveIndex(index);
        setOpen(true);
      }
    }
  }

  return (
    <div
      className={cn("relative min-w-0", props.className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      ref={rootRef}
    >
      <button
        aria-activedescendant={expanded && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        aria-controls={expanded ? `${id}-listbox` : undefined}
        aria-expanded={expanded}
        aria-haspopup="listbox"
        aria-label={props.label}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-ui-2 rounded-ui-md border bg-surface px-ui-3 text-left text-sm shadow-ui-xs outline-none transition-colors hover:border-ui-border-strong focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none",
          expanded ? "border-primary/40 bg-surface-raised" : "border-ui-border-strong",
          !selected && "text-muted-foreground",
        )}
        disabled={props.disabled}
        onClick={() => expanded ? setOpen(false) : show()}
        onKeyDown={handleKeyDown}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        <span className="min-w-0 truncate" title={selected?.label}>{selected?.label ?? props.placeholder ?? "请选择"}</span>
        <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-subtle-foreground" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d={expanded ? "m7 14 5-5 5 5" : "m7 10 5 5 5-5"} />
        </svg>
      </button>
      {expanded ? createPortal(
        <div
          aria-label={props.label}
          className="fixed z-[120] overflow-y-auto overscroll-contain rounded-ui-md border border-ui-border bg-surface-raised p-ui-1.5 shadow-ui-overlay"
          id={`${id}-listbox`}
          ref={menuRef}
          role="listbox"
          style={position}
        >
          {props.options.map((option, index) => (
            <div
              aria-disabled={option.disabled || undefined}
              aria-selected={option.value === props.value}
              className={cn(
                "flex min-h-9 items-center gap-ui-2 rounded-ui-sm px-ui-2 py-ui-2 text-sm",
                option.disabled ? "cursor-not-allowed text-subtle-foreground opacity-60" : "cursor-pointer text-foreground",
                !option.disabled && index === activeIndex && "bg-primary-soft",
              )}
              id={`${id}-option-${index}`}
              key={option.value}
              onClick={() => choose(index)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => { if (!option.disabled) setActiveIndex(index); }}
              role="option"
            >
              <span className="min-w-0 flex-1 break-words">{option.label}</span>
              {option.value === props.value ? <span aria-hidden="true" className="shrink-0 text-primary">✓</span> : null}
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
