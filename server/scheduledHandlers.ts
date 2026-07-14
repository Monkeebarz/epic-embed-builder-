/**
 * Express handlers for /api/scheduled/* heartbeat callbacks.
 */
import type { Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { getPool, type RsvpEvent } from "./featureDb";
import type { RowDataPacket } from "mysql2/promise";
import { runReminderSweep, cleanupEventCron } from "./reminderScheduler";

export async function rsvpReminderHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) {
      return res.status(403).json({ error: "cron-only" });
    }

    // Look up the event by taskUid — never trust req.body.
    const [rows] = await getPool().execute<RowDataPacket[]>(
      "SELECT * FROM rsvp_events WHERE schedule_cron_task_uid = ? LIMIT 1",
      [user.taskUid],
    );
    const event = (rows[0] as RsvpEvent) ?? null;
    if (!event) {
      // Orphan cron — self-destruct so it stops firing, respond 2xx to stop retries.
      await cleanupEventCron(user.taskUid);
      return res.json({ ok: true, skipped: "orphan" });
    }

    const result = await runReminderSweep(event);

    if (result.done) {
      // All reminders delivered (or expired) — remove the cron.
      await cleanupEventCron(user.taskUid);
    }

    return res.json({ ok: true, eventId: event.id, ...result });
  } catch (error) {
    const err = error as Error;
    return res.status(500).json({
      error: err.message,
      stack: err.stack,
      context: { url: req.originalUrl },
      timestamp: new Date().toISOString(),
    });
  }
}
