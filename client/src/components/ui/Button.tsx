import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/ui";

export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-ui-2 whitespace-nowrap rounded-ui-md font-semibold outline-none transition-[background-color,border-color,color,box-shadow,transform] duration-ui-normal ease-ui-standard focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none motion-reduce:transform-none",
  {
    variants: {
      variant: {
        primary:
          "border border-transparent bg-primary text-primary-foreground shadow-ui-xs hover:bg-primary-hover active:bg-primary-active",
        secondary:
          "border border-ui-border-strong bg-surface text-foreground shadow-ui-xs hover:border-primary/30 hover:bg-primary-soft/60 active:bg-primary-soft",
        ghost:
          "border border-transparent bg-transparent text-muted-foreground hover:bg-surface-muted hover:text-foreground active:bg-primary-soft",
        danger:
          "border border-danger/15 bg-danger-soft text-danger hover:border-danger/25 hover:bg-danger-soft/75 active:text-danger-hover"
      },
      size: {
        sm: "h-8 px-ui-3 text-[length:var(--font-size-ui-sm)] leading-[var(--line-height-ui-sm)]",
        md: "h-9 px-ui-4 text-[length:var(--font-size-ui-md)] leading-[var(--line-height-ui-md)]",
        lg: "h-10 px-ui-5 text-[length:var(--font-size-ui-md)] leading-[var(--line-height-ui-md)]",
        "icon-sm": "h-7 w-7 p-0 text-[length:var(--font-size-ui-sm)] leading-[var(--line-height-ui-sm)]",
        icon: "h-8 w-8 p-0 text-[length:var(--font-size-ui-md)] leading-[var(--line-height-ui-md)]"
      }
    },
    defaultVariants: {
      variant: "secondary",
      size: "md"
    }
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { asChild = false, className, size, type, variant, ...props },
  ref
) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={cn(buttonVariants({ size, variant }), className)}
      ref={ref}
      type={asChild ? undefined : type ?? "button"}
      {...props}
    />
  );
});
