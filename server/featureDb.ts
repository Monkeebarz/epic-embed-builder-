/**
 * Feature tables use raw mysql2/promise queries (no ORM) per project requirements.
 * Tables: embed_templates, rsvp_events, rsvp_attendees
 */
import mysql from "mysql2/promise";
import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    pool = mysql.createPool({
      uri: process.env.DATABASE_URL,
      connectionLimit: 5,
      enableKeepAlive: true,
    });
  }
  return pool;
}

// ---------- Types ----------
export type EmbedTemplate = {
  id: number;
  name: string;
  title: string;
  description: string | null;
  color: string;
  thumbnail_url: string | null;
  image_url: string | null;
  footer_text: string | null;
  event_time_utc: number | null;
  channel_id: string | null;
  role_ping_ids: string | null; // JSON array stored as TEXT, e.g. '["id1","id2"]'
  rsvp_enabled: number;
  max_attendees: number | null;
  rsvp_deadline_utc: number | null;
  dm_message: string | null;
  game_link: string | null;
  auto_assign_role_id: string | null;
  remind_1h: number;
  remind_10m: number;
  remind_at_start: number;
};

export type RsvpEvent = {
  id: number;
  message_id: string;
  channel_id: string;
  title: string;
  event_time_utc: number | null;
  rsvp_deadline_utc: number | null;
  max_attendees: number | null;
  dm_message: string | null;
  game_link: string | null;
  auto_assign_role_id: string | null;
  remind_1h: number;
  remind_10m: number;
  remind_at_start: number;
  remind_1h_sent: number;
  remind_10m_sent: number;
  remind_at_start_sent: number;
  schedule_cron_task_uid: string | null;
  attendee_count?: number;
};

export type TemplateInput = {
  name: string;
  title: string;
  description: string | null;
  color: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  footerText: string | null;
  eventTimeUtc: number | null;
  channelId: string | null;
  rolePingIds: string[];
  rsvpEnabled: boolean;
  maxAttendees: number | null;
  rsvpDeadlineUtc: number | null;
  dmMessage: string | null;
  gameLink: string | null;
  autoAssignRoleId: string | null;
  remind1h: boolean;
  remind10m: boolean;
  remindAtStart: boolean;
};

// ---------- Templates ----------
export async function saveTemplate(t: TemplateInput): Promise<number> {
  const sql = `INSERT INTO embed_templates
    (name, title, description, color, thumbnail_url, image_url, footer_text, event_time_utc,
     channel_id, role_ping_ids, rsvp_enabled, max_attendees, rsvp_deadline_utc, dm_message,
     game_link, auto_assign_role_id, remind_1h, remind_10m, remind_at_start)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
     title=VALUES(title), description=VALUES(description), color=VALUES(color),
     thumbnail_url=VALUES(thumbnail_url), image_url=VALUES(image_url), footer_text=VALUES(footer_text),
     event_time_utc=VALUES(event_time_utc), channel_id=VALUES(channel_id), role_ping_ids=VALUES(role_ping_ids),
     rsvp_enabled=VALUES(rsvp_enabled), max_attendees=VALUES(max_attendees),
     rsvp_deadline_utc=VALUES(rsvp_deadline_utc), dm_message=VALUES(dm_message),
     game_link=VALUES(game_link), auto_assign_role_id=VALUES(auto_assign_role_id),
     remind_1h=VALUES(remind_1h), remind_10m=VALUES(remind_10m), remind_at_start=VALUES(remind_at_start)`;
  const [result] = await getPool().execute<ResultSetHeader>(sql, [
    t.name, t.title, t.description, t.color, t.thumbnailUrl, t.imageUrl, t.footerText,
    t.eventTimeUtc, t.channelId, JSON.stringify(t.rolePingIds), t.rsvpEnabled ? 1 : 0, t.maxAttendees,
    t.rsvpDeadlineUtc, t.dmMessage, t.gameLink, t.autoAssignRoleId,
    t.remind1h ? 1 : 0, t.remind10m ? 1 : 0, t.remindAtStart ? 1 : 0,
  ]);
  return result.insertId;
}

export async function listTemplates(): Promise<EmbedTemplate[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    "SELECT * FROM embed_templates ORDER BY updated_at DESC",
  );
  return rows as EmbedTemplate[];
}

export async function getTemplate(id: number): Promise<EmbedTemplate | null> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    "SELECT * FROM embed_templates WHERE id = ? LIMIT 1", [id],
  );
  return (rows[0] as EmbedTemplate) ?? null;
}

export async function deleteTemplate(id: number): Promise<void> {
  await getPool().execute("DELETE FROM embed_templates WHERE id = ?", [id]);
}

// ---------- RSVP events ----------
export async function createRsvpEvent(e: {
  messageId: string;
  channelId: string;
  title: string;
  eventTimeUtc: number | null;
  rsvpDeadlineUtc: number | null;
  maxAttendees: number | null;
  dmMessage: string | null;
  gameLink: string | null;
  autoAssignRoleId: string | null;
  remind1h: boolean;
  remind10m: boolean;
  remindAtStart: boolean;
}): Promise<number> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `INSERT INTO rsvp_events
     (message_id, channel_id, title, event_time_utc, rsvp_deadline_utc, max_attendees,
      dm_message, game_link, auto_assign_role_id, remind_1h, remind_10m, remind_at_start)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.messageId, e.channelId, e.title, e.eventTimeUtc, e.rsvpDeadlineUtc, e.maxAttendees,
      e.dmMessage, e.gameLink, e.autoAssignRoleId,
      e.remind1h ? 1 : 0, e.remind10m ? 1 : 0, e.remindAtStart ? 1 : 0,
    ],
  );
  return result.insertId;
}

export async function getRsvpEventByMessageId(messageId: string): Promise<RsvpEvent | null> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    "SELECT * FROM rsvp_events WHERE message_id = ? LIMIT 1", [messageId],
  );
  return (rows[0] as RsvpEvent) ?? null;
}

export async function getRsvpEventById(id: number): Promise<RsvpEvent | null> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    "SELECT * FROM rsvp_events WHERE id = ? LIMIT 1", [id],
  );
  return (rows[0] as RsvpEvent) ?? null;
}

export async function setEventCronTaskUid(eventId: number, taskUid: string): Promise<void> {
  await getPool().execute(
    "UPDATE rsvp_events SET schedule_cron_task_uid = ? WHERE id = ?", [taskUid, eventId],
  );
}

export async function markReminderSent(
  eventId: number,
  which: "remind_1h_sent" | "remind_10m_sent" | "remind_at_start_sent",
): Promise<void> {
  await getPool().execute(`UPDATE rsvp_events SET ${which} = 1 WHERE id = ?`, [eventId]);
}

export async function listRsvpEvents(): Promise<RsvpEvent[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT e.*, COUNT(a.id) AS attendee_count
     FROM rsvp_events e
     LEFT JOIN rsvp_attendees a ON a.event_id = e.id
     GROUP BY e.id
     ORDER BY e.created_at DESC
     LIMIT 50`,
  );
  return rows as RsvpEvent[];
}

/** Events that still have unsent reminders and an event time (used by the reminder sweep). */
export async function listPendingReminderEvents(): Promise<RsvpEvent[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT * FROM rsvp_events
     WHERE event_time_utc IS NOT NULL
       AND ((remind_1h = 1 AND remind_1h_sent = 0)
         OR (remind_10m = 1 AND remind_10m_sent = 0)
         OR (remind_at_start = 1 AND remind_at_start_sent = 0))`,
  );
  return rows as RsvpEvent[];
}

// ---------- Attendees ----------
export async function addAttendee(
  eventId: number,
  discordUserId: string,
  discordUsername: string | null,
): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `INSERT IGNORE INTO rsvp_attendees (event_id, discord_user_id, discord_username) VALUES (?, ?, ?)`,
    [eventId, discordUserId, discordUsername],
  );
  return result.affectedRows > 0;
}

export async function removeAttendee(eventId: number, discordUserId: string): Promise<void> {
  await getPool().execute(
    "DELETE FROM rsvp_attendees WHERE event_id = ? AND discord_user_id = ?",
    [eventId, discordUserId],
  );
}

export async function countAttendees(eventId: number): Promise<number> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS c FROM rsvp_attendees WHERE event_id = ?", [eventId],
  );
  return Number((rows[0] as { c: number }).c);
}

export async function listAttendees(eventId: number): Promise<
  { discord_user_id: string; discord_username: string | null; rsvped_at: Date }[]
> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    "SELECT discord_user_id, discord_username, rsvped_at FROM rsvp_attendees WHERE event_id = ? ORDER BY rsvped_at ASC",
    [eventId],
  );
  return rows as { discord_user_id: string; discord_username: string | null; rsvped_at: Date }[];
}
