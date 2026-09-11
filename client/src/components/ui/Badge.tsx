import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import { cn } from "../../lib/ui";

const badgeVariants = cva(
  "inline-flex min-w-0 select-none items-center gap-ui-1 rounded-ui-full font-medium",
  {
    variants: {
      variant: {
        neutral: "bg-surface-muted text-muted-foreground",
        primary: "bg-primary-soft text-primary",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-danger-soft text-danger",
        outline: "border border-ui-border bg-surface text-muted-foreground"
      },
      size: {
        sm: "min-h-5 px-ui-2 text-[length:var(--font-size-ui-xs)] leading-[var(--line-height-ui-xs)]",
        md: "min-h-6 px-ui-3 text-[length:var(--font-size-ui-sm)] leading-[var(--line-height-ui-sm)]"
      }
    },
    defaultVariants: {
      variant: "neutral",
      size: "sm"
    }
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, size, variant, ...props }: BadgeProps): JSX.Element {
  return <span className={cn(badgeVariants({ size, variant }), className)} {...props} />;
}
