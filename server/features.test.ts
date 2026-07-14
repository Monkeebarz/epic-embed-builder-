import { describe, expect, it, afterAll } from "vitest";
import { checkAdminPassword, createAdminToken, verifyAdminToken } from "./adminAuth";
import { chicagoLocalToUtcMs, utcMsToChicagoLocal, formatChicago } from "../shared/timezone";
import { dueReminders, allRemindersDone } from "./reminderScheduler";
import { buildEmbed } from "./discordBot";
import {
  saveTemplate, listTemplates, deleteTemplate, getPool, type RsvpEvent,
} from "./featureDb";

describe("admin auth", () => {
  it("accepts the correct ADMIN_PASSWORD", () => {
    expect(checkAdminPassword(process.env.ADMIN_PASSWORD ?? "")).toBe(true);
  });
  it("rejects wrong passwords", () => {
    expect(checkAdminPassword("wrong-password")).toBe(false);
    expect(checkAdminPassword("")).toBe(false);
  });
  it("issues and verifies admin tokens", async () => {
    const token = await createAdminToken();
    expect(await verifyAdminToken(token)).toBe(true);
    expect(await verifyAdminToken("garbage")).toBe(false);
    expect(await verifyAdminToken(undefined)).toBe(false);
  });
});

describe("CDT timezone conversion", () => {
  it("converts Chicago local to UTC ms (CDT, UTC-5)", () => {
    // Jul 15 2026 19:00 CDT == Jul 16 2026 00:00 UTC
    const ms = chicagoLocalToUtcMs("2026-07-15T19:00");
    expect(ms).toBe(Date.UTC(2026, 6, 16, 0, 0));
  });
  it("converts Chicago local to UTC ms (CST, UTC-6)", () => {
    // Jan 15 2026 19:00 CST == Jan 16 2026 01:00 UTC
    const ms = chicagoLocalToUtcMs("2026-01-15T19:00");
    expect(ms).toBe(Date.UTC(2026, 0, 16, 1, 0));
  });
  it("round-trips UTC↔Chicago", () => {
    const local = "2026-07-15T19:30";
    const ms = chicagoLocalToUtcMs(local)!;
    expect(utcMsToChicagoLocal(ms)).toBe(local);
  });
  it("formats readable Chicago time", () => {
    const ms = chicagoLocalToUtcMs("2026-07-15T19:00")!;
    const s = formatChicago(ms);
    expect(s).toContain("Jul 15");
    expect(s).toContain("7:00");
    expect(s).toContain("CDT");
  });
});

describe("reminder due logic", () => {
  const base: RsvpEvent = {
    id: 1, message_id: "m", channel_id: "c", title: "Test",
    event_time_utc: 0, rsvp_deadline_utc: null, max_attendees: null,
    dm_message: null, game_link: null, auto_assign_role_id: null,
    remind_1h: 1, remind_10m: 1, remind_at_start: 1,
    remind_1h_sent: 0, remind_10m_sent: 0, remind_at_start_sent: 0,
    schedule_cron_task_uid: null,
  };
  const T = Date.UTC(2026, 6, 16, 0, 0);

  it("fires 1h reminder inside its window", () => {
    const e = { ...base, event_time_utc: T };
    expect(dueReminders(e, T - 60 * 60 * 1000)).toContain("1h");
    expect(dueReminders(e, T - 60 * 60 * 1000 + 5 * 60 * 1000)).toContain("1h");
  });
  it("fires 10m reminder inside its window", () => {
    const e = { ...base, event_time_utc: T };
    expect(dueReminders(e, T - 10 * 60 * 1000)).toContain("10m");
  });
  it("fires at-start reminder at exactly event time", () => {
    const e = { ...base, event_time_utc: T };
    expect(dueReminders(e, T)).toContain("start");
    expect(dueReminders(e, T + 60 * 1000)).toContain("start");
  });
  it("does not fire before windows open", () => {
    const e = { ...base, event_time_utc: T };
    expect(dueReminders(e, T - 2 * 60 * 60 * 1000)).toEqual([]);
  });
  it("does not re-fire sent reminders", () => {
    const e = { ...base, event_time_utc: T, remind_1h_sent: 1 as const };
    expect(dueReminders(e, T - 60 * 60 * 1000)).toEqual([]);
  });
  it("reports done after event passes", () => {
    const e = { ...base, event_time_utc: T, remind_1h_sent: 1, remind_10m_sent: 1, remind_at_start_sent: 1 };
    expect(allRemindersDone(e, T + 21 * 60 * 1000)).toBe(true);
  });
  it("not done while reminders still pending", () => {
    const e = { ...base, event_time_utc: T };
    expect(allRemindersDone(e, T - 2 * 60 * 60 * 1000)).toBe(false);
  });
});

describe("embed building", () => {
  it("builds embed with all fields and no default thumbnail", () => {
    const embed = buildEmbed({
      title: "Poker Night", description: "Join us", color: "#6A0DAD",
      thumbnailUrl: null, imageUrl: "https://example.com/img.png",
      footerText: "EPIC", eventTimeUtc: Date.UTC(2026, 6, 16),
      channelId: "c", rolePingId: null, rsvpEnabled: true,
      maxAttendees: 9, rsvpDeadlineUtc: null,
    });
    const json = embed.toJSON();
    expect(json.title).toBe("Poker Night");
    expect(json.color).toBe(0x6a0dad);
    expect(json.thumbnail).toBeUndefined(); // logo NOT auto-added
    expect(json.image?.url).toBe("https://example.com/img.png");
    expect(json.fields?.some(f => f.name.includes("RSVP"))).toBe(true);
  });
  it("omits RSVP field when rsvp is off", () => {
    const embed = buildEmbed({
      title: "Announcement", description: null, color: "#ffffff",
      thumbnailUrl: null, imageUrl: null, footerText: null, eventTimeUtc: null,
      channelId: "c", rolePingId: null, rsvpEnabled: false,
      maxAttendees: null, rsvpDeadlineUtc: null,
    });
    const json = embed.toJSON();
    expect(json.fields ?? []).toHaveLength(0);
  });
});

describe("template CRUD (MySQL, raw mysql2)", () => {
  const name = `__vitest_${Date.now()}`;
  afterAll(async () => {
    await getPool().execute("DELETE FROM embed_templates WHERE name LIKE '__vitest_%'");
    await getPool().end();
  });

  it("saves, lists (all fields), and deletes a template", async () => {
    const id = await saveTemplate({
      name, title: "T1", description: "D1", color: "#123456",
      thumbnailUrl: "https://x/t.png", imageUrl: "https://x/i.png",
      footerText: "F1", eventTimeUtc: 1780000000000, channelId: "111",
      rolePingIds: ["222", "333"], rsvpEnabled: true, maxAttendees: 9,
      rsvpDeadlineUtc: 1779990000000, dmMessage: "DM!", gameLink: "https://x/game",
      autoAssignRoleId: "444", remind1h: true, remind10m: false, remindAtStart: true,
    });
    expect(id).toBeGreaterThan(0);

    const all = await listTemplates();
    const t = all.find(t => t.name === name)!;
    expect(t).toBeDefined();
    // ENTIRE form state persisted:
    expect(t.title).toBe("T1");
    expect(t.description).toBe("D1");
    expect(t.color).toBe("#123456");
    expect(t.thumbnail_url).toBe("https://x/t.png");
    expect(t.image_url).toBe("https://x/i.png");
    expect(t.footer_text).toBe("F1");
    expect(Number(t.event_time_utc)).toBe(1780000000000);
    expect(t.channel_id).toBe("111");
    expect(JSON.parse(t.role_ping_ids ?? "[]")).toEqual(["222", "333"]);
    expect(t.rsvp_enabled).toBe(1);
    expect(t.max_attendees).toBe(9);
    expect(Number(t.rsvp_deadline_utc)).toBe(1779990000000);
    expect(t.dm_message).toBe("DM!");
    expect(t.game_link).toBe("https://x/game");
    expect(t.auto_assign_role_id).toBe("444");
    expect(t.remind_1h).toBe(1);
    expect(t.remind_10m).toBe(0);
    expect(t.remind_at_start).toBe(1);

    await deleteTemplate(t.id);
    const after = await listTemplates();
    expect(after.find(x => x.id === t.id)).toBeUndefined();
  });
});
