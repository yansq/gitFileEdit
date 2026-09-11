import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { type CSSProperties, type ReactNode } from "react";
import { cn } from "../../lib/ui";

export interface SegmentedControlItem<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  ariaLabel: string;
  className?: string;
  items: ReadonlyArray<SegmentedControlItem<T>>;
  onValueChange: (value: T) => void;
  size?: "sm" | "md";
  tone?: "brand" | "fragment" | "neutral";
  value: T;
}

export function SegmentedControl<T extends string>({
  ariaLabel,
  className,
  items,
  onValueChange,
  size = "md",
  tone = "brand",
  value
}: SegmentedControlProps<T>): JSX.Element {
  const selectedIndex = Math.max(0, items.findIndex((item) => item.value === value));
  const itemCount = Math.max(1, items.length);
  const gapWidth = (itemCount - 1) * 4;
  const indicatorStyle: CSSProperties = {
    width: `calc((100% - ${8 + gapWidth}px) / ${itemCount})`,
    transform: `translateX(calc(${selectedIndex * 100}% + ${selectedIndex * 4}px))`
  };
  const rootStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${itemCount}, minmax(0, 1fr))`
  };

  return (
    <ToggleGroup.Root
      aria-label={ariaLabel}
      className={cn(
        "relative isolate grid gap-ui-1 overflow-hidden rounded-ui-md border border-primary/10 bg-surface-muted p-ui-1 shadow-ui-inset",
        className
      )}
      onValueChange={(nextValue) => {
        if (nextValue) {
          onValueChange(nextValue as T);
        }
      }}
      orientation="horizontal"
      style={rootStyle}
      type="single"
      value={value}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute bottom-ui-1 left-ui-1 top-ui-1 z-0 rounded-ui-sm shadow-ui-sm transition-transform duration-ui-slow ease-ui-emphasized motion-reduce:transition-none",
          tone === "brand"
            ? "bg-primary"
            : tone === "fragment"
              ? "bg-[#7654ca]"
              : "bg-surface"
        )}
        style={indicatorStyle}
      />
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <ToggleGroup.Item
            aria-current={selected ? "page" : undefined}
            className={cn(
              "relative z-10 min-w-0 rounded-ui-sm bg-transparent px-ui-3 font-semibold outline-none transition-colors duration-ui-normal ease-ui-standard focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none",
              size === "sm"
                ? "h-7 px-ui-2 text-[length:var(--font-size-ui-xs)] leading-[var(--line-height-ui-xs)]"
                : "h-8 text-[length:var(--font-size-ui-sm)] leading-[var(--line-height-ui-sm)]",
              selected
                ? tone === "neutral"
                  ? "text-foreground"
                  : "text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            disabled={item.disabled}
            key={item.value}
            value={item.value}
          >
            <span className="block truncate">{item.label}</span>
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
