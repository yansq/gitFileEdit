import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../lib/ui";

type ToastTone = "success" | "info" | "error";

const toastToneClasses: Record<ToastTone, { icon: string; label: string }> = {
  success: { icon: "bg-success-soft text-success", label: "成功" },
  info: { icon: "bg-primary-soft text-primary", label: "提示" },
  error: { icon: "bg-danger-soft text-danger", label: "错误" },
};

function ToastTypeIcon({ tone }: { tone: ToastTone }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-ui-full",
        toastToneClasses[tone].icon,
      )}
    >
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        {tone === "success" ? (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="m8 12 2.5 2.5L16 9" />
          </>
        ) : tone === "info" ? (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </>
        ) : (
          <>
            <path d="M10.3 4.2 2.7 17.4A1.7 1.7 0 0 0 4.2 20h15.6a1.7 1.7 0 0 0 1.5-2.6L13.7 4.2a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v4M12 16.5h.01" />
          </>
        )}
      </svg>
    </span>
  );
}

function ToastItem(props: {
  duration: number;
  message: string;
  onDismiss: () => void;
  tone: ToastTone;
}): JSX.Element {
  const [visible, setVisible] = useState(false);
  const dismissingRef = useRef(false);
  const exitTimerRef = useRef<number | null>(null);
  const onDismissRef = useRef(props.onDismiss);

  useEffect(() => {
    onDismissRef.current = props.onDismiss;
  }, [props.onDismiss]);

  const dismiss = useCallback(() => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    setVisible(false);
    exitTimerRef.current = window.setTimeout(() => onDismissRef.current(), 180);
  }, []);

  useEffect(() => {
    const enterFrame = window.requestAnimationFrame(() => setVisible(true));
    const autoDismissTimer = window.setTimeout(dismiss, props.duration);
    return () => {
      window.cancelAnimationFrame(enterFrame);
      window.clearTimeout(autoDismissTimer);
      if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current);
    };
  }, [dismiss, props.duration]);

  const toneLabel = toastToneClasses[props.tone].label;

  return (
    <div
      className={cn(
        "pointer-events-auto grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-ui-3 rounded-ui-lg border border-ui-border bg-surface/95 px-ui-3 py-ui-3 text-sm text-foreground shadow-ui-overlay backdrop-blur transition-[opacity,transform] duration-ui-normal ease-ui-emphasized motion-reduce:transition-none",
        visible ? "translate-y-0 scale-100 opacity-100" : "-translate-y-2 scale-[0.98] opacity-0",
      )}
      role={props.tone === "error" ? "alert" : "status"}
    >
      <ToastTypeIcon tone={props.tone} />
      <span className="min-w-0 break-words leading-5">{props.message}</span>
      <button
        aria-label={`关闭${toneLabel}消息`}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-ui-sm text-subtle-foreground outline-none transition-colors duration-ui-fast hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/25"
        onClick={dismiss}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}

export function ToastStack(props: {
  error: string | null;
  liveNotice: string | null;
  message: string | null;
  onDismissError: () => void;
  onDismissLiveNotice: () => void;
  onDismissMessage: () => void;
}): JSX.Element | null {
  if (!props.message && !props.liveNotice && !props.error) return null;

  return (
    <div
      aria-atomic="false"
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 top-ui-4 z-[120] grid w-[min(400px,calc(100vw-32px))] -translate-x-1/2 gap-ui-2"
    >
      {props.message ? (
        <ToastItem
          duration={3600}
          key={`success:${props.message}`}
          message={props.message}
          onDismiss={props.onDismissMessage}
          tone="success"
        />
      ) : null}
      {props.liveNotice ? (
        <ToastItem
          duration={4200}
          key={`info:${props.liveNotice}`}
          message={props.liveNotice}
          onDismiss={props.onDismissLiveNotice}
          tone="info"
        />
      ) : null}
      {props.error ? (
        <ToastItem
          duration={5600}
          key={`error:${props.error}`}
          message={props.error}
          onDismiss={props.onDismissError}
          tone="error"
        />
      ) : null}
    </div>
  );
}
