import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "./_core/trpc";
import { verifyAdminToken, getAdminCookie } from "./adminAuth";
import {
  saveTemplate,
  listTemplates,
  deleteTemplate,
  createRsvpEvent,
  listRsvpEvents,
  listAttendees,
} from "./featureDb";
import { fetchTextChannels, fetchRoles, sendEmbedToChannel, setAppOrigin } from "./discordBot";
import { scheduleEventReminders } from "./reminderScheduler";

/** Admin-gated procedure using the password-session cookie (no OAuth). */
const adminGate = publicProcedure.use(async ({ ctx, next }) => {
  const ok = await verifyAdminToken(getAdminCookie(ctx.req));
  if (!ok) throw new TRPCError({ code: "UNAUTHORIZED", message: "Admin login required" });
  return next({ ctx });
});

const formSchema = z.object({
  title: z.string().max(256),
  description: z.string().max(4000).nullable(),
  color: z.string().max(9),
  thumbnailUrl: z.string().max(2000).nullable(),
  imageUrl: z.string().max(2000).nullable(),
  footerText: z.string().max(2048).nullable(),
  eventTimeUtc: z.number().nullable(),
  channelId: z.string().nullable(),
  rolePingIds: z.array(z.string()).default([]),
  rsvpEnabled: z.boolean(),
  maxAttendees: z.number().int().positive().nullable(),
  rsvpDeadlineUtc: z.number().nullable(),
  dmMessage: z.string().max(2000).nullable(),
  gameLink: z.string().max(2000).nullable(),
  autoAssignRoleId: z.string().nullable(),
  remind1h: z.boolean(),
  remind10m: z.boolean(),
  remindAtStart: z.boolean(),
});

export const embedRouter = router({
  discord: router({
    channels: adminGate.query(async () => fetchTextChannels()),
    roles: adminGate.query(async () => fetchRoles()),
  }),

  templates: router({
    list: adminGate.query(async () => listTemplates()),
    save: adminGate
      .input(formSchema.extend({ name: z.string().min(1).max(191) }))
      .mutation(async ({ input }) => {
        const id = await saveTemplate({ ...input, rolePingIds: input.rolePingIds });
        return { id };
      }),
    delete: adminGate
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await deleteTemplate(input.id);
        return { ok: true };
      }),
  }),

  send: adminGate.input(formSchema).mutation(async ({ ctx, input }) => {
    if (!input.channelId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Select a channel first" });
    }
    // Capture the public origin so the default logo thumbnail resolves to an absolute URL.
    const proto = (ctx.req.headers["x-forwarded-proto"] as string) ?? "https";
    const host = (ctx.req.headers["x-forwarded-host"] as string) ?? ctx.req.headers.host ?? "";
    if (host && !host.startsWith("localhost")) setAppOrigin(`${proto}://${host}`);
    const posted = await sendEmbedToChannel({
      title: input.title,
      description: input.description,
      color: input.color,
      thumbnailUrl: input.thumbnailUrl,
      imageUrl: input.imageUrl,
      footerText: input.footerText,
      eventTimeUtc: input.eventTimeUtc,
      channelId: input.channelId,
      rolePingIds: input.rolePingIds,
      rsvpEnabled: input.rsvpEnabled,
      maxAttendees: input.maxAttendees,
      rsvpDeadlineUtc: input.rsvpDeadlineUtc,
    });

    let eventId: number | null = null;
    let reminderScheduled = false;
    if (input.rsvpEnabled) {
      eventId = await createRsvpEvent({
        messageId: posted.messageId,
        channelId: posted.channelId,
        title: input.title,
        eventTimeUtc: input.eventTimeUtc,
        rsvpDeadlineUtc: input.rsvpDeadlineUtc,
        maxAttendees: input.maxAttendees,
        dmMessage: input.dmMessage,
        gameLink: input.gameLink,
        autoAssignRoleId: input.autoAssignRoleId,
        remind1h: input.remind1h,
        remind10m: input.remind10m,
        remindAtStart: input.remindAtStart,
      });

      // Schedule reminder heartbeat if any reminder toggle is on and event time set.
      if (input.eventTimeUtc && (input.remind1h || input.remind10m || input.remindAtStart)) {
        // Heartbeat jobs are attributed to the project owner (empty session).
        try {
          const taskUid = await scheduleEventReminders(eventId);
          reminderScheduled = !!taskUid;
        } catch (err) {
          console.error("[Reminders] scheduling failed:", err);
        }
      }
    }

    return { ...posted, eventId, reminderScheduled };
  }),

  events: router({
    list: adminGate.query(async () => {
      const events = await listRsvpEvents();
      return events.map(e => ({
        ...e,
        event_time_utc: e.event_time_utc !== null ? Number(e.event_time_utc) : null,
        rsvp_deadline_utc: e.rsvp_deadline_utc !== null ? Number(e.rsvp_deadline_utc) : null,
        attendee_count: Number(e.attendee_count ?? 0),
      }));
    }),
    attendees: adminGate
      .input(z.object({ eventId: z.number().int() }))
      .query(async ({ input }) => listAttendees(input.eventId)),
  }),
});
