import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.js";
import type { Analysis, Turn } from "@aside/engine/core";
import {
  InteractiveProvider,
  LiveCreationRejected,
} from "../../backend/src/interactive-provider.js";
import { enabled, release } from "./trial.js";
interface State {
  owner: string;
  token: string;
  episode: string;
  deadline: number;
  session?: string;
  closing?: boolean;
  confirmed?: boolean;
}
/**
 * The supplier no longer knows this session. Its `session.closed` frame can
 * never arrive, so the attach can never succeed and must not be retried.
 */
class SessionGone extends Error {}

/**
 * How long past its deadline a session may stay unconfirmed before the
 * supervisor releases it anyway. The breaker it leaves behind pauses every
 * listener's AI, so an unbounded wait turns one lost close acknowledgement
 * into a site-wide outage.
 */
const closeGraceMs = 15 * 60 * 1000;

/** The browser never owns the lease or the authoritative close acknowledgement. */
export class LiveSupervisor extends DurableObject<Env> {
  private socket?: WebSocket;
  private pending: Promise<unknown> = Promise.resolve();
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.pending.then(run, run);
    this.pending = next.catch(() => {});
    return next;
  }

  start(
    owner: string,
    token: string,
    episode: string,
    sdp: string,
    analysis: Analysis,
    atMs: number,
    history: Turn[],
  ) {
    return this.serial(() =>
      this.startSession(owner, token, episode, sdp, analysis, atMs, history),
    );
  }
  private async startSession(
    owner: string,
    token: string,
    episode: string,
    sdp: string,
    analysis: Analysis,
    atMs: number,
    history: Turn[],
  ) {
    const previous = await this.ctx.storage.get<State>("state");
    if (previous?.confirmed) await this.confirm(previous);
    if (await this.ctx.storage.get("state"))
      throw Error("Voice session already active");
    const state: State = {
      owner,
      token,
      episode,
      deadline: Date.now() + 120000,
    };
    await this.ctx.storage.put("state", state);
    await this.ctx.storage.setAlarm(Date.now() + 10000);
    try {
      const result = await new InteractiveProvider(
        this.env.OPENAI_API_KEY!,
        this.env.ASIDE_BACKEND_MODEL,
      ).createLive(sdp, analysis, atMs, history);
      state.session = result.session.id;
      await this.ctx.storage.put("state", state);
      await this.env.DB.prepare(
        "INSERT INTO voice_usage(session_id,owner_id,episode_id) VALUES(?,?,?)",
      )
        .bind(state.session, owner, episode)
        .run();
      await this.attach(state);
      if (Date.now() >= state.deadline || !(await enabled(this.env)))
        throw Error("Trial stopped");
      return result;
    } catch (error) {
      if (error instanceof LiveCreationRejected && !state.session) {
        await this.ctx.storage.delete("state");
        await this.ctx.storage.deleteAlarm();
        await release(this.env, owner, "live", token);
        throw error;
      }
      state.closing = true;
      await this.ctx.storage.put("state", state);
      await this.breaker(state);
      await this.ctx.storage.setAlarm(Date.now() + 1000);
      throw error;
    }
  }
  /**
   * Releases everything a finished session holds. `finalize` marks the usage
   * row as supplier-confirmed, which only a real `session.closed` frame or a
   * 404 from the supplier may claim.
   */
  private async retire(state: State, finalize: boolean) {
    await this.env.DB.batch([
      ...(finalize && state.session
        ? [
            this.env.DB.prepare(
              "UPDATE voice_usage SET finalized=1 WHERE session_id=? AND owner_id=?",
            ).bind(state.session, state.owner),
          ]
        : []),
      this.env.DB.prepare("DELETE FROM trial_breakers WHERE owner=?").bind(
        state.owner,
      ),
      this.env.DB.prepare(
        "DELETE FROM trial_leases WHERE owner=? AND kind='live' AND token=?",
      ).bind(state.owner, state.token),
    ]);
    await this.ctx.storage.delete("state");
    await this.ctx.storage.deleteAlarm();
    this.socket?.close();
    this.socket = undefined;
  }

  /**
   * An attach that cannot be established must not pause every listener's AI
   * forever. A 404 means the supplier dropped the session; anything else is
   * still given the whole grace window past the deadline before release.
   */
  private async handleAttachFailure(state: State, error: unknown) {
    const dropped = error instanceof SessionGone;
    const expired = Date.now() > state.deadline + closeGraceMs;
    if (!dropped && !expired) {
      await this.breaker(state);
      return;
    }
    console.error("Aside voice session released without a close acknowledgement", {
      owner: state.owner,
      session: state.session,
      dropped,
      error: error instanceof Error ? error.message : String(error),
    });
    await this.retire(state, dropped);
  }
  private async breaker(state: State) {
    await this.env.DB.prepare("INSERT OR IGNORE INTO trial_breakers VALUES(?)")
      .bind(state.owner)
      .run();
  }
  private async attach(state: State) {
    if (this.socket?.readyState === 1) return;
    if (!state.session)
      throw Error("Unknown session; operator reconciliation required");
    const response = await fetch(
      `https://api.openai.com/v1/live/sessions/${encodeURIComponent(state.session)}/attach`,
      {
        headers: {
          Upgrade: "websocket",
          Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    const socket = response.webSocket;
    if (!socket) {
      // A 404 is the supplier saying the session is over; anything else is
      // transient and keeps the breaker until the close is confirmed.
      if (response.status === 404) throw new SessionGone(state.session);
      throw Error("Sideband unavailable");
    }
    socket.accept();
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "session.closed")
          this.ctx.waitUntil(this.serial(() => this.confirm(state)));
      } catch {
        /* Ignore non-JSON frames. */
      }
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = undefined;
    });
    socket.addEventListener("error", () => {
      if (this.socket === socket) this.socket = undefined;
    });
  }
  private async confirm(state: State) {
    const current = await this.ctx.storage.get<State>("state");
    if (current?.token !== state.token) return;
    // Persist the terminal acknowledgement before D1 changes; alarm can finish after a restart.
    await this.ctx.storage.put("state", { ...current, confirmed: true });
    await this.retire(state, true);
  }
  close(session: string) {
    return this.serial(() => this.closeSession(session));
  }
  private async closeSession(session: string) {
    const state = await this.ctx.storage.get<State>("state");
    if (!state || state.session !== session) return;
    state.closing = true;
    await this.ctx.storage.put("state", state);
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    try {
      await this.attach(state);
      this.socket!.send(JSON.stringify({ type: "session.close" }));
    } catch (error) {
      await this.handleAttachFailure(state, error);
    }
  }
  alarm() {
    return this.serial(() => this.tick());
  }
  private async tick() {
    const state = await this.ctx.storage.get<State>("state");
    if (!state) return;
    if (state.confirmed) {
      await this.confirm(state);
      return;
    }
    // Re-arm before network work so a transient failure cannot orphan a session.
    await this.ctx.storage.setAlarm(
      state.deadline > Date.now()
        ? Math.min(state.deadline, Date.now() + 5000)
        : Date.now() + 5000,
    );
    try {
      if (!state.session) {
        if (state.closing || Date.now() >= state.deadline) {
          await this.breaker(state);
          // No session id exists to reconnect to; keep the breaker for operator reconciliation.
          await this.ctx.storage.deleteAlarm();
        }
        return;
      }
      await this.attach(state);
      if (
        state.closing ||
        Date.now() >= state.deadline ||
        !(await enabled(this.env))
      ) {
        const waitingForClose = state.closing;
        state.closing = true;
        await this.ctx.storage.put("state", state);
        if (waitingForClose) await this.breaker(state);
        this.socket!.send(JSON.stringify({ type: "session.close" }));
      }
    } catch (error) {
      await this.handleAttachFailure(state, error);
    }
  }
}
