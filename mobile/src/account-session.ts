export interface AccountSession<T> {
  restore(): Promise<void>;
  me(): Promise<{ user: T | null }>;
  forget(): Promise<void>;
}

/** A connection failure says nothing about the validity of stored credentials. */
export async function restoreAccount<T>(session: AccountSession<T>) {
  await session.restore();
  try {
    const account = await session.me();
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
