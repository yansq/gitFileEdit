import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "../../lib/ui";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) =>
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
}

export function Modal(props: {
  children: ReactNode;
  className?: string;
  closeDisabled?: boolean;
  labelledBy: string;
  onClose: () => void;
  overlayClassName?: string;
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const focusFrame = window.requestAnimationFrame(() => {
      const autofocusTarget = dialog?.querySelector<HTMLElement>("[autofocus]");
      const focusTarget = autofocusTarget ?? (dialog ? getFocusableElements(dialog)[0] : null) ?? dialog;
      focusTarget?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape" && !props.closeDisabled) {
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
      return;
    }

    if (event.key !== "Tab" || !dialogRef.current) return;

    const focusableElements = getFocusableElements(dialogRef.current);
    if (!focusableElements.length) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (
      event.shiftKey &&
      (activeElement === firstElement || !dialogRef.current.contains(activeElement))
    ) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] grid place-items-center overflow-hidden overscroll-contain bg-foreground/35 p-ui-4 backdrop-blur-sm",
        props.overlayClassName,
      )}
      onKeyDown={handleKeyDown}
    >
      <div
        aria-labelledby={props.labelledBy}
        aria-modal="true"
        className={cn(
          "w-full rounded-ui-lg border border-ui-border bg-surface shadow-ui-overlay",
          props.className,
        )}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {props.children}
      </div>
    </div>
  );
}
