import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { t } from "./i18n";
import "./account.css";

export interface User {
  id: string;
  email: string;
  alias: string;
  description: string;
  avatarUrl: string | null;
}
interface Session {
  user: User | null;
  emailEnabled: boolean;
  googleEnabled: boolean;
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw Error(body?.error ?? t("请求失败，请重试"));
  }
  return response.json();
}
const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function AccountControl({
  onAuthChanged,
  onUserChanged,
  enterSpace = false,
}: {
  onAuthChanged: () => Promise<void>;
  onUserChanged?: (user: User | null) => void;
  enterSpace?: boolean;
}) {
  const [session, setSession] = useState<Session>();
  const [sessionFailed, setSessionFailed] = useState(false);
  const [view, setView] = useState<"closed" | "login" | "profile">("closed");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [alias, setAlias] = useState("");
  const [description, setDescription] = useState("");
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void request<Session>("/api/auth/session")
      .then((next) => {
        if (!active) return;
        setSession(next);
        setAlias(next.user?.alias ?? "");
        setDescription(next.user?.description ?? "");
        const params = new URL(location.href).searchParams;
        if (params.has("authError")) {
          setView("login");
          setError(t("请先用邮件验证码验证邮箱，再从个人资料关联 Google。"));
          history.replaceState(null, "", location.pathname);
        } else if (next.user && params.has("profile")) {
          setView("profile");
          history.replaceState(null, "", location.pathname);
          void onAuthChanged();
        }
      })
      .catch(() => {
        if (active) setSessionFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const user = session?.user;
  useEffect(() => {
    onUserChanged?.(
      user
        ? {
            ...user,
            avatarUrl: user.avatarUrl?.startsWith("/api/")
              ? `${user.avatarUrl}${user.avatarUrl.includes("?") ? "&" : "?"}v=${avatarVersion}`
              : user.avatarUrl,
          }
        : null,
    );
  }, [user, avatarVersion, onUserChanged]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("请求失败，请重试"));
    } finally {
      setBusy(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await request("/api/auth/email/start", json({ email }));
      setSent(true);
    });
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const next = await request<{ user: User }>(
        "/api/auth/email/verify",
        json({ email, code }),
      );
      setSession((previous) => ({
        emailEnabled: previous?.emailEnabled ?? true,
        googleEnabled: previous?.googleEnabled ?? false,
        user: next.user,
      }));
      setAlias(next.user.alias);
      setDescription(next.user.description);
      setView("closed");
      await onAuthChanged();
      // Signing in leads to the listener's own space, not to a profile form.
      // Someone who signs in beside an open episode stays with it.
      const listening =
        location.pathname.startsWith("/episodes/") ||
        new URLSearchParams(location.search).has("episode");
      if (location.pathname !== "/space" && !listening)
        location.assign("/space");
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const next = await request<{ user: User }>("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias, description }),
      });
      setSession((previous) =>
        previous ? { ...previous, user: next.user } : previous,
      );
      setView("closed");
      await onAuthChanged();
    });
  }
  async function avatar(file?: File) {
    if (!file) return;
    await run(async () => {
      if (file.size > 2 * 1024 * 1024) throw Error(t("头像不能超过 2 MB"));
      await request("/api/profile/avatar", {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      setSession((previous) =>
        previous?.user
          ? {
              ...previous,
              user: { ...previous.user, avatarUrl: "/api/profile/avatar" },
            }
          : previous,
      );
      setAvatarVersion((version) => version + 1);
      await onAuthChanged();
    });
  }
  async function logout() {
    await run(async () => {
      await request("/api/auth/logout", { method: "POST" });
      setSession((previous) =>
        previous ? { ...previous, user: null } : previous,
      );
      setView("closed");
      setSent(false);
      setCode("");
      await onAuthChanged();
    });
  }
  return (
    <>
      {user && enterSpace ? (
        <a className="account-trigger btn btn-secondary" href="/space">
          Enter My Space
        </a>
      ) : (
        <button
          className="account-trigger btn btn-secondary"
          onClick={() => {
            setError("");
            setView(user ? "profile" : "login");
          }}
          aria-label={user ? t("编辑个人资料") : t("登录 / 注册")}
        >
          {user ? (
            <>
              <span className="account-avatar-small">
                {user.avatarUrl ? (
                  <img
                    src={
                      user.avatarUrl +
                      (user.avatarUrl.startsWith("/api/")
                        ? `?v=${avatarVersion}`
                        : "")
                    }
                    alt=""
                  />
                ) : (
                  user.alias.slice(0, 1).toUpperCase()
                )}
              </span>
              <span>{user.alias}</span>
            </>
          ) : (
            t("登录 / 注册")
          )}
        </button>
      )}
      {view !== "closed" &&
        createPortal(
          <div
            className="account-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setView("closed");
            }}
          >
            <section
              className="account-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="account-title"
            >
              <div className="account-head">
                <span className="account-badge" aria-hidden="true">
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <path d="M3 6v4M6 3.5v9M10 5v6M13 7v2" />
                  </svg>
                </span>
                <button
                  className="account-close btn btn-quiet btn-icon btn-sm"
                  aria-label={t("关闭")}
                  onClick={() => setView("closed")}
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="m4 4 8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
              {view === "login" ? (
                <>
                  <div className="account-intro">
                    <h2 id="account-title">{t("从这里继续听")}</h2>
                    <p>{t("登录后保存你的音频和收听进度。")}</p>
                  </div>
                  {session?.googleEnabled && (
                    <a
                      className="account-google btn btn-secondary btn-lg btn-block"
                      href="/api/auth/google"
                    >
                      <span className="account-g" aria-hidden="true">
                        G
                      </span>
                      {t("使用 Google 登录")}
                    </a>
                  )}
                  {session?.googleEnabled && session.emailEnabled && (
                    <div className="account-divider">{t("或用邮箱")}</div>
                  )}
                  {session?.emailEnabled && (
                    <form onSubmit={sent ? verify : send}>
                      <label htmlFor="account-email">{t("邮箱")}</label>
                      <div className="input-wrap">
                        <svg
                          className="input-icon"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <rect x="2" y="3.5" width="12" height="9" rx="2" />
                          <path d="m2.5 4.5 5.5 4 5.5-4" />
                        </svg>
                        <input
                          id="account-email"
                          className="input has-icon"
                          type="email"
                          autoComplete="email"
                          placeholder="name@example.com"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          required
                          disabled={sent || busy}
                        />
                      </div>
                      {sent && (
                        <>
                          <label htmlFor="account-code">
                            {t("邮件验证码")}
                          </label>
                          <input
                            id="account-code"
                            className="input"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            pattern="[0-9]{8}"
                            maxLength={8}
                            value={code}
                            onChange={(event) => setCode(event.target.value)}
                            required
                            disabled={busy}
                          />
                          <button
                            type="button"
                            className="account-text btn btn-quiet btn-sm"
                            onClick={() => {
                              setSent(false);
                              setCode("");
                            }}
                          >
                            {t("更换邮箱或重发")}
                          </button>
                        </>
                      )}
                      <button
                        className="account-primary btn btn-primary btn-lg btn-block"
                        disabled={busy}
                      >
                        {busy
                          ? t("请稍候…")
                          : sent
                            ? t("验证并登录")
                            : t("发送验证码")}
                      </button>
                    </form>
                  )}
                  {!session && (
                    <p role="status">
                      {sessionFailed
                        ? t("登录服务暂时不可用，请稍后刷新重试。")
                        : t("请稍候…")}
                    </p>
                  )}
                  {session &&
                    !session.emailEnabled &&
                    !session.googleEnabled && <p>{t("登录服务尚未配置")}</p>}
                </>
              ) : (
                <>
                  <h2 id="account-title">{t("个人资料")}</h2>
                  <form onSubmit={save}>
                    <label className="account-avatar-picker">
                      <span className="account-avatar-large">
                        {user?.avatarUrl ? (
                          <img
                            src={
                              user.avatarUrl +
                              (user.avatarUrl.startsWith("/api/")
                                ? `?v=${avatarVersion}`
                                : "")
                            }
                            alt=""
                          />
                        ) : (
                          user?.alias.slice(0, 1).toUpperCase()
                        )}
                      </span>
                      <span>
                        {t("更换头像")}
                        <small>PNG / JPEG / WebP · 2 MB</small>
                      </span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) =>
                          void avatar(event.target.files?.[0])
                        }
                        disabled={busy}
                      />
                    </label>
                    <label htmlFor="account-alias">{t("昵称")}</label>
                    <input
                      id="account-alias"
                      className="input"
                      value={alias}
                      onChange={(event) => setAlias(event.target.value)}
                      maxLength={40}
                      required
                    />
                    <label htmlFor="account-description">{t("介绍")}</label>
                    <textarea
                      id="account-description"
                      className="input"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      maxLength={500}
                      rows={4}
                      placeholder={t("说说你喜欢听什么…")}
                    />
                    <small className="account-email">{user?.email}</small>
                    <button
                      className="account-primary btn btn-primary btn-lg btn-block"
                      disabled={busy}
                    >
                      {busy ? t("请稍候…") : t("保存资料")}
                    </button>
                  </form>
                  <button
                    className="account-text btn btn-quiet btn-sm"
                    onClick={() => void logout()}
                    disabled={busy}
                  >
                    {t("退出登录")}
                  </button>
                  {session?.googleEnabled && (
                    <a
                      className="account-text btn btn-quiet btn-sm"
                      href="/api/auth/google"
                    >
                      {t("关联 Google 账号")}
                    </a>
                  )}
                </>
              )}
              {error && (
                <p className="account-error" role="alert">
                  {error}
                </p>
              )}
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
