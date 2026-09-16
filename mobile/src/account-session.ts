export interface AccountSession<T> {
  readonly token?: string | null;
  restore(): Promise<void>;
  me(): Promise<{ user: T | null }>;
  forget(): Promise<void>;
}

/** A connection failure says nothing about the validity of stored credentials. */
export async function restoreAccount<T>(session: AccountSession<T>) {
  await session.restore();
  try {
    const account = await session.me();
    // An older web-only deployment can return guest JSON for a valid Bearer.
    // Only the mobile API's explicit 401 confirms that credential is invalid.
    if (!account.user && session.token)
      throw new Error(
        "手机登录服务暂时不可用，请重试 / Mobile sign-in is temporarily unavailable. Please retry.",
      );
    if (!account.user) await session.forget();
    return account.user;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 401
    ) {
      await session.forget();
      return null;
    }
    throw error;
  }
}
