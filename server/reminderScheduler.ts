/**
 * Reminder scheduling via Manus Heartbeat cron.
 *
 * Strategy: a single project-level sweep job (created once via CLI/bootstrap route)
 * plus per-event one-off precision jobs are overkill for a small guild, so we use a
 *"per-event heartbeat" model: when an RSVP embed with reminders is posted, we create
 * ONE heartbeat job for that event that fires every minute; the handler checks which
 * reminder windows (1h / 10m / at-start) are due, sends the DMs, marks them sent, and
 * deletes the job after the final reminder fires. Idempotent via *_sent flags.
 */
import { createHeartbeatJob, deleteHeartbeatJob } from "./_core/heartbeat";
import {
  getRsvpEventById,
  markReminderSent,
  setEventCronTaskUid,
  type RsvpEvent,
} from "./featureDb";
import { reconcileEventReactions, sendReminderDMs } from "./discordBot";

const SWEEP_CRON = "0 * * * * *"; // every minute (6-field, UTC)

/**
 * NOTE: heartbeat calls pass an EMPTY userSession — the SDK then attributes the
 * cron to the project owner. This app uses a custom admin-password gate (no Manus
 * OAuth cookie), so owner fallback is the correct, reliable identity.
 */
export async function scheduleEventReminders(eventId: number): Promise<string | null> {
  const event = await getRsvpEventById(eventId);
  if (!event || !event.event_time_utc) return null;
  const wantsReminders = event.remind_1h || event.remind_10m || event.remind_at_start;
  if (!wantsReminders) return null;

  const job = await createHeartbeatJob(
    {
      name: `rsvp-reminders-${eventId}`,
      cron: SWEEP_CRON,
      path: "/api/scheduled/rsvpReminder",
      payload: {},
      description: `RSVP reminder sweep for event #${eventId} (${event.title})`,
    },
    "",
  );
  await setEventCronTaskUid(eventId, job.taskUid);
  return job.taskUid;
}

/** Which reminders are due right now for this event. */
export function dueReminders(event: RsvpEvent, nowMs: number): ("1h" | "10m" | "start")[] {
  const t = Number(event.event_time_utc);
  if (!t) return [];
  const due: ("1h" | "10m" | "start")[] = [];
  // A reminder is due once "now" has passed its trigger time. Grace window of 15 min
  // so a missed sweep still sends (but wildly stale reminders are skipped, except
  // at-start which must always fire once the event time is reached, per requirements).
  const GRACE = 15 * 60 * 1000;
  const oneHourMark = t - 60 * 60 * 1000;
  const tenMinMark = t - 10 * 60 * 1000;
  if (event.remind_1h && !event.remind_1h_sent && nowMs >= oneHourMark && nowMs < oneHourMark + GRACE) {
    due.push("1h");
  }
  if (event.remind_10m && !event.remind_10m_sent && nowMs >= tenMinMark && nowMs < tenMinMark + GRACE) {
    due.push("10m");
  }
  if (event.remind_at_start && !event.remind_at_start_sent && nowMs >= t && nowMs < t + GRACE) {
    due.push("start");
  }
  return due;
}

/** True when nothing remains for this event's cron to do. */
export function allRemindersDone(event: RsvpEvent, nowMs: number): boolean {
  const t = Number(event.event_time_utc);
  if (!t) return true;
  // After event start + grace, nothing more will ever fire.
  if (nowMs > t + 20 * 60 * 1000) return true;
  const pending1h = event.remind_1h && !event.remind_1h_sent && nowMs < t - 60 * 60 * 1000 + 15 * 60 * 1000;
  const pending10m = event.remind_10m && !event.remind_10m_sent && nowMs < t - 10 * 60 * 1000 + 15 * 60 * 1000;
  const pendingStart = event.remind_at_start && !event.remind_at_start_sent;
  return !pending1h && !pending10m && !pendingStart;
}

const SENT_COLUMN = {
  "1h": "remind_1h_sent",
  "10m": "remind_10m_sent",
  start: "remind_at_start_sent",
} as const;

/**
 * Process one sweep tick for the event bound to the given cron taskUid.
 * Returns a summary for the heartbeat response body.
 */
export async function runReminderSweep(event: RsvpEvent): Promise<{
  sent: Record<string, number>;
  done: boolean;
}> {
  const now = Date.now();
  // Pick up any RSVPs that happened while no instance was listening.
  await reconcileEventReactions(event);

  const sent: Record<string, number> = {};
  for (const kind of dueReminders(event, now)) {
    // Mark sent FIRST for idempotency (platform retries on 5xx).
    await markReminderSent(event.id, SENT_COLUMN[kind]);
    sent[kind] = await sendReminderDMs(event, kind);
  }

  const refreshed = await getRsvpEventById(event.id);
  const done = refreshed ? allRemindersDone(refreshed, Date.now()) : true;
  return { sent, done };
}

export async function cleanupEventCron(taskUid: string): Promise<void> {
  try {
    await deleteHeartbeatJob(taskUid, "");
  } catch (err) {
    console.error("[Reminders] failed to delete heartbeat job:", err);
  }
}
