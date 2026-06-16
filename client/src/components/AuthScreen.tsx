import type { FormEvent } from "react";
import { cn, formLabelClass, formRowClass, inputClass, panelClass, primaryButtonClass, secondaryButtonClass } from "../lib/ui";

export interface LoginFormState {
  username: string;
  password: string;
  confirmPassword: string;
}

export function AuthScreen(props: {
  authMode: "login" | "register";
  error: string | null;
  loggingIn: boolean;
  loginForm: LoginFormState;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onFormChange: (nextValue: LoginFormState) => void;
  onModeToggle: () => void;
}): JSX.Element {
  const isRegistering = props.authMode === "register";

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form
        className={cn(panelClass, "w-full max-w-[420px]")}
        onSubmit={props.onSubmit}
      >
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-[#5a7a72]">
          Git File Console
        </p>
        <h1 className="m-0 text-3xl leading-tight">
          {isRegistering ? "注册账号（请使用真实姓名或工号）" : "登录后修改配置"}
        </h1>
        <div className="mt-6 grid gap-4">
          <label className={formRowClass}>
            <span className={formLabelClass}>账号</span>
            <input
              className={inputClass}
              autoComplete="username"
              value={props.loginForm.username}
              onChange={(event) =>
                props.onFormChange({
                  ...props.loginForm,
                  username: event.target.value
                })
              }
            />
          </label>
          <label className={formRowClass}>
            <span className={formLabelClass}>密码</span>
            <input
              className={inputClass}
              type="password"
              autoComplete={isRegistering ? "new-password" : "current-password"}
              value={props.loginForm.password}
              onChange={(event) =>
                props.onFormChange({
                  ...props.loginForm,
                  password: event.target.value
                })
              }
            />
          </label>
          {isRegistering ? (
            <label className={formRowClass}>
              <span className={formLabelClass}>确认密码</span>
              <input
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={props.loginForm.confirmPassword}
                onChange={(event) =>
                  props.onFormChange({
                    ...props.loginForm,
                    confirmPassword: event.target.value
                  })
                }
              />
            </label>
          ) : null}
          {props.error ? (
            <div className="rounded-2xl bg-[#c94a35]/10 px-3.5 py-3 text-sm text-[#8d3322]">
              {props.error}
            </div>
          ) : null}
          <button
            className={primaryButtonClass}
            disabled={
              !props.loginForm.username ||
              !props.loginForm.password ||
              (isRegistering && !props.loginForm.confirmPassword) ||
              props.loggingIn
            }
          >
            {props.loggingIn
              ? isRegistering
                ? "注册中..."
                : "登录中..."
              : isRegistering
                ? "注册并登录"
                : "登录"}
          </button>
          <button
            className={secondaryButtonClass}
            type="button"
            onClick={props.onModeToggle}
          >
            {isRegistering ? "已有账号，去登录" : "没有账号，去注册"}
          </button>
        </div>
      </form>
    </div>
  );
}
