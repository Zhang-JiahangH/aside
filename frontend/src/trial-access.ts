import { t, getLocale } from "./i18n";
type Widget = {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
};
let cloud = false;
let pending: Promise<void> | undefined;
let script: Promise<Widget> | undefined;
export function configureTrial(value: boolean) {
  cloud = value;
}
function widget(): Promise<Widget> {
  return (script ??= new Promise((resolve, reject) => {
    const element = document.createElement("script");
    element.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    element.async = true;
    const fail = () => {
      clearTimeout(timer);
      script = undefined;
      element.remove();
      reject(Error(t("无法加载试用验证，请稍后重试")));
    };
    const timer = setTimeout(fail, 15000);
    element.onload = () => {
      clearTimeout(timer);
      const api = (window as unknown as { turnstile?: Widget }).turnstile;
      api ? resolve(api) : fail();
    };
    element.onerror = fail;
    document.head.append(element);
  }));
}
async function verify(upload: boolean) {
  const response = await fetch("/api/trial");
  if (!response.ok) throw Error(t("无法获取试用状态"));
  const status = (await response.json()) as {
    verified: boolean;
    enabled: boolean;
    siteKey?: string;
    challenge: string;
  };
  if (!status.enabled) throw Error(t("AI 试用暂时关闭，仍可继续收听"));
  if (status.verified) return;
  if (!status.siteKey) throw Error(t("试用验证尚未配置"));
  const turnstile = await widget();
  await new Promise<void>((resolve, reject) => {
    const dialog = document.createElement("dialog");
    const heading = document.createElement("h2");
    heading.textContent = t(upload ? "验证并上传" : "开始免费试用");
    heading.id = "trial-heading";
    dialog.setAttribute("aria-labelledby", heading.id);
    const copy = document.createElement("p");
    copy.textContent = t(upload
      ? "完成验证后即可上传。每个账号每月最多 100 篇，上传完成后自动分析。"
      : "完成验证即可提问。每天 5 次提问，每次语音连接最多 2 分钟。");
    const target = document.createElement("div");
    const cancel = document.createElement("button");
    cancel.textContent = t("继续收听");
    dialog.append(heading, copy, target, cancel);
    document.body.append(dialog);
    let id: string | undefined,
      settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (id) turnstile.remove(id);
      dialog.close();
      dialog.remove();
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(
      () => finish(Error(t("验证已超时，请重试"))),
      120000,
    );
    cancel.onclick = () => finish(Error(t("已取消试用验证")));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(Error(t("已取消试用验证")));
    });
    dialog.showModal();
    id = turnstile.render(target, {
      sitekey: status.siteKey,
      language: getLocale() === "zh" ? "zh-cn" : "en",
      action: "aside-trial",
      cData: status.challenge,
      callback: async (token: string) => {
        try {
          const result = await fetch("/api/trial", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
            signal: AbortSignal.timeout(10000),
          });
          if (!result.ok) throw Error(t("验证失败，请重试"));
          finish();
        } catch (error) {
          finish(error instanceof Error ? error : Error(t("验证失败")));
        }
      },
      "error-callback": () => finish(Error(t("验证失败，请重试"))),
      "expired-callback": () => finish(Error(t("验证已过期，请重试"))),
    });
  });
}
async function ensure(upload = false) {
  if (!cloud) return;
  if (!pending)
    pending = verify(upload).finally(() => {
      pending = undefined;
    });
  return pending;
}
/** Offer guest verification alongside the entry permission flow, without blocking audio. */
export async function prepareTrial() {
  if (!cloud) return;
  const response = await fetch("/api/trial");
  if (!response.ok) return;
  const status = (await response.json()) as { verified: boolean; enabled: boolean; siteKey?: string };
  if (!status.enabled || status.verified || !status.siteKey) return;
  try {
    await ensure();
  } catch (error) {
    if (error instanceof Error && error.message === t("已取消试用验证")) return;
    throw error;
  }
}
export async function trialFetch(path: string, init?: RequestInit) {
  const upload = path.startsWith("/api/uploads");
  await ensure(upload);
  init?.signal?.throwIfAborted();
  let response = await fetch(path, init);
  if (cloud && response.status === 403) {
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    if (body?.code === "trial_verification_required") {
      await ensure(upload);
      init?.signal?.throwIfAborted();
      response = await fetch(path, init);
    }
  }
  return response;
}
