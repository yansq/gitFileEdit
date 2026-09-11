import { forwardRef, type ReactNode } from "react";
import { Button, type ButtonProps } from "./Button";

export interface IconButtonProps extends Omit<ButtonProps, "aria-label" | "children" | "size"> {
  label: string;
  children: ReactNode;
  size?: "sm" | "md";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { children, label, size = "md", ...props },
  ref
) {
  return (
    <Button
      aria-label={label}
      ref={ref}
      size={size === "sm" ? "icon-sm" : "icon"}
      {...props}
    >
      {children}
    </Button>
  );
});
