import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LoginFormState } from "../../components/AuthScreen";
import { ApiRequestError, requestJson } from "../../lib/api";
import type { AuthUser } from "../../types";

interface AuthResponse {
  user: AuthUser;
}

const emptyLoginForm: LoginFormState = {
  username: "",
  password: "",
  confirmPassword: "",
};

export function useAuthSession(options: {
  onActivated: () => void;
  onAuthenticated: () => Promise<void>;
  onError: (message: string | null) => void;
  onMessage: (message: string | null) => void;
  onSessionReset: () => void;
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checked, setChecked] = useState(false);
  const [loginForm, setLoginForm] = useState<LoginFormState>(emptyLoginForm);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [submitting, setSubmitting] = useState(false);
  const [activationCode, setActivationCode] = useState("");
  const [activating, setActivating] = useState(false);
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  function resetSession(): void {
    setUser(null);
    setActivationCode("");
    callbacksRef.current.onSessionReset();
  }

  function handleAuthRequired(error: unknown): boolean {
    if (!(error instanceof ApiRequestError) || error.status !== 401) return false;

    resetSession();
    setChecked(true);
    callbacksRef.current.onError(null);
    callbacksRef.current.onMessage(null);
    return true;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/auth/me");
        if (!response.ok) {
          if (!cancelled) {
            resetSession();
            callbacksRef.current.onError(null);
          }
          return;
        }

        const payload = (await response.json()) as AuthResponse;
        if (cancelled) return;
        setUser(payload.user);
        await callbacksRef.current.onAuthenticated();
      } catch (error) {
        if (!cancelled) callbacksRef.current.onError((error as Error).message);
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    callbacksRef.current.onError(null);
    callbacksRef.current.onMessage(null);

    try {
      if (mode === "register" && loginForm.password !== loginForm.confirmPassword) {
        throw new Error("两次输入的密码不一致");
      }

      const payload = await requestJson<AuthResponse>(
        mode === "register" ? "/api/auth/register" : "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            username: loginForm.username,
            password: loginForm.password,
          }),
        },
      );
      setUser(payload.user);
      setLoginForm(emptyLoginForm);
      await callbacksRef.current.onAuthenticated();
    } catch (error) {
      if (!handleAuthRequired(error)) callbacksRef.current.onError((error as Error).message);
    } finally {
      setSubmitting(false);
      setChecked(true);
    }
  }

  async function logout(): Promise<void> {
    await requestJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" }).catch(() => ({
      ok: true,
    }));
    resetSession();
    callbacksRef.current.onError(null);
    callbacksRef.current.onMessage(null);
  }

  async function activate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setActivating(true);
    callbacksRef.current.onError(null);
    callbacksRef.current.onMessage(null);

    try {
      const payload = await requestJson<AuthResponse>("/api/auth/activate-admin", {
        method: "POST",
        body: JSON.stringify({ code: activationCode }),
      });
      setUser(payload.user);
      setActivationCode("");
      callbacksRef.current.onActivated();
      callbacksRef.current.onMessage("已升级为管理员");
    } catch (error) {
      if (!handleAuthRequired(error)) callbacksRef.current.onError((error as Error).message);
    } finally {
      setActivating(false);
    }
  }

  function toggleMode(): void {
    setMode((current) => (current === "login" ? "register" : "login"));
    setLoginForm(emptyLoginForm);
    callbacksRef.current.onError(null);
  }

  return {
    activate,
    activating,
    activationCode,
    checked,
    handleAuthRequired,
    loginForm,
    logout,
    mode,
    setActivationCode,
    setLoginForm,
    submit,
    submitting,
    toggleMode,
    user,
  };
}
