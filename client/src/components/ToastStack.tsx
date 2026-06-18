export function ToastStack(props: {
  message: string | null;
  liveNotice: string | null;
  error: string | null;
}): JSX.Element | null {
  if (!props.message && !props.liveNotice && !props.error) {
    return null;
  }

  return (
    <div
      className="fixed left-1/2 top-4 z-50 grid w-[min(380px,calc(100vw-32px))] -translate-x-1/2 gap-2"
      aria-live="polite"
      aria-atomic="true"
    >
      {props.message ? (
        <div className="rounded-2xl border border-[#1d8c68]/15 bg-white/95 px-4 py-3 text-sm text-[#12684d] shadow-[0_18px_50px_rgba(28,64,54,0.16)] backdrop-blur">
          {props.message}
        </div>
      ) : null}
      {props.liveNotice ? (
        <div className="rounded-2xl border border-[#2475b2]/15 bg-white/95 px-4 py-3 text-sm text-[#18527e] shadow-[0_18px_50px_rgba(28,64,54,0.16)] backdrop-blur">
          {props.liveNotice}
        </div>
      ) : null}
      {props.error ? (
        <div className="rounded-2xl border border-[#c94a35]/15 bg-white/95 px-4 py-3 text-sm text-[#8d3322] shadow-[0_18px_50px_rgba(28,64,54,0.16)] backdrop-blur">
          {props.error}
        </div>
      ) : null}
    </div>
  );
}
