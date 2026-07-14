/**
 * Discord bot integration (discord.js v14).
 *
 * IMPORTANT runtime note: this app deploys to autoscale (serverless) hosting, so
 * a persistent gateway connection cannot be relied on between requests. The client
 * lazily (re)connects on demand. Reaction events are handled while an instance is
 * warm; the reminder heartbeat sweep (every minute) also reconciles RSVP state from
 * the message's reactions so RSVPs made while no instance was listening are not lost.
 */
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  TextChannel,
  MessageReaction,
  PartialMessageReaction,
  User as DiscordUser,
  PartialUser,
} from "discord.js";
import {
  addAttendee,
  removeAttendee,
  countAttendees,
  getRsvpEventByMessageId,
  type RsvpEvent,
} from "./featureDb";
import { listAttendees } from "./featureDb";
import { listRsvpEvents } from "./featureDb";
import { formatChicago } from "../shared/timezone";
import { EPIC_LOGO_PATH } from "../shared/const";

const RSVP_EMOJI = "✅";

/**
 * Public origin of this app (captured from incoming requests). Kept available
 * for building absolute URLs (e.g. OG image) if needed server-side.
 */
let appOrigin: string | null = process.env.APP_PUBLIC_URL ?? null;
export function setAppOrigin(origin: string) {
  if (origin && origin.startsWith("http")) appOrigin = origin.replace(/\/$/, "");
}
export function defaultLogoUrl(): string | null {
  return appOrigin ? `${appOrigin}${EPIC_LOGO_PATH}` : null;
}

let client: Client | null = null;
let readyPromise: Promise<Client> | null = null;

export function getBotClient(): Promise<Client> {
  if (client && client.isReady()) return Promise.resolve(client);
  if (readyPromise) return readyPromise;

  readyPromise = new Promise<Client>((resolve, reject) => {
    const c = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
    });

    c.on("messageReactionAdd", (reaction, user) => {
      handleReactionAdd(reaction, user).catch(err =>
        console.error("[Discord] reaction add handler error:", err),
      );
    });

    c.on("messageReactionRemove", (reaction, user) => {
      handleReactionRemove(reaction, user).catch(err =>
        console.error("[Discord] reaction remove handler error:", err),
      );
    });

    c.once("clientReady", () => {
      console.log(`[Discord] Bot ready as ${c.user?.tag}`);
      client = c;
      resolve(c);
    });

    c.on("error", err => console.error("[Discord] client error:", err));

    c.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
      readyPromise = null;
      reject(err);
    });
  });
  return readyPromise;
}

export async function getGuild() {
  const c = await getBotClient();
  const guildId = process.env.DISCORD_GUILD_ID ?? "";
  return c.guilds.fetch(guildId);
}

export async function fetchTextChannels(): Promise<{ id: string; name: string }[]> {
  const guild = await getGuild();
  const channels = await guild.channels.fetch();
  return Array.from(channels.values())
    .filter((ch): ch is NonNullable<typeof ch> => !!ch && ch.isTextBased())
    .map(ch => ({ id: ch.id, name: ch.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchRoles(): Promise<{ id: string; name: string; color: string }[]> {
  const guild = await getGuild();
  const roles = await guild.roles.fetch();
  return Array.from(roles.values())
    .filter(r => !r.managed)
    .sort((a, b) => b.position - a.position)
    .map(r => ({ id: r.id, name: r.name, color: r.hexColor }));
}

export type SendEmbedInput = {
  title: string;
  description: string | null;
  color: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  footerText: string | null;
  eventTimeUtc: number | null;
  channelId: string;
  rolePingIds: string[];
  rsvpEnabled: boolean;
  maxAttendees: number | null;
  rsvpDeadlineUtc: number | null;
};

function isValidHttpUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function buildEmbed(input: SendEmbedInput): EmbedBuilder {
  const embed = new EmbedBuilder();
  if (input.title) embed.setTitle(input.title);
  if (input.description) embed.setDescription(input.description);
  const hex = input.color?.replace(/[^0-9a-fA-F]/g, "");
  if (hex && hex.length === 6) embed.setColor(parseInt(hex, 16));
  // Thumbnail only when explicitly provided in the form (per user requirement,
  // the EPIC logo is NOT auto-added to bot embeds — it's the site OG image only).
  if (isValidHttpUrl(input.thumbnailUrl)) embed.setThumbnail(input.thumbnailUrl);
  if (isValidHttpUrl(input.imageUrl)) embed.setImage(input.imageUrl);
  if (input.footerText) embed.setFooter({ text: input.footerText });
  if (input.eventTimeUtc) {
    const unix = Math.floor(input.eventTimeUtc / 1000);
    embed.addFields({
      name: "📅 Event Time",
      value: `<t:${unix}:F> (<t:${unix}:R>)`,
      inline: false,
    });
    embed.setTimestamp(new Date(input.eventTimeUtc));
  }
  if (input.rsvpEnabled) {
    const lines: string[] = [`React with ${RSVP_EMOJI} to RSVP!`];
    if (input.maxAttendees) lines.push(`Max attendees: **${input.maxAttendees}**`);
    if (input.rsvpDeadlineUtc) {
      lines.push(`RSVP by <t:${Math.floor(input.rsvpDeadlineUtc / 1000)}:F>`);
    }
    embed.addFields({ name: "🎟️ RSVP", value: lines.join("\n"), inline: false });
  }
  return embed;
}

export async function sendEmbedToChannel(
  input: SendEmbedInput,
): Promise<{ messageId: string; channelId: string }> {
  const guild = await getGuild();
  const channel = await guild.channels.fetch(input.channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error("Selected channel is not a text channel");
  }
  const embed = buildEmbed(input);
  const pings = input.rolePingIds.map(id => `<@&${id}>`).join(" ");
  const content = pings || undefined;
  const message = await (channel as TextChannel).send({
    content,
    embeds: [embed],
    allowedMentions: input.rolePingIds.length ? { roles: input.rolePingIds } : undefined,
  });
  // RSVP ON → add checkmark reaction; RSVP OFF → no reaction at all.
  if (input.rsvpEnabled) {
    await message.react(RSVP_EMOJI);
  }
  return { messageId: message.id, channelId: channel.id };
}

// ---------- RSVP reaction handling ----------
async function handleReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: DiscordUser | PartialUser,
) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch();
  if (reaction.emoji.name !== RSVP_EMOJI) return;

  const event = await getRsvpEventByMessageId(reaction.message.id);
  if (!event) return;

  await processRsvpJoin(event, user.id, user.username ?? null);
}

async function handleReactionRemove(
  reaction: MessageReaction | PartialMessageReaction,
  user: DiscordUser | PartialUser,
) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch();
  if (reaction.emoji.name !== RSVP_EMOJI) return;

  const event = await getRsvpEventByMessageId(reaction.message.id);
  if (!event) return;

  await processRsvpLeave(event, user.id);
}

/** Shared join logic used by both the live reaction handler and the reconcile sweep. */
export async function processRsvpJoin(
  event: RsvpEvent,
  userId: string,
  username: string | null,
): Promise<void> {
  const now = Date.now();
  // Deadline passed → ignore
  if (event.rsvp_deadline_utc && now > Number(event.rsvp_deadline_utc)) return;
  // Capacity check
  if (event.max_attendees) {
    const count = await countAttendees(event.id);
    if (count >= event.max_attendees) return;
  }
  const added = await addAttendee(event.id, userId, username);
  if (!added) return; // already RSVP'd — don't re-DM

  const guild = await getGuild();

  // Auto-assign role
  if (event.auto_assign_role_id) {
    try {
      const member = await guild.members.fetch(userId);
      await member.roles.add(event.auto_assign_role_id);
    } catch (err) {
      console.error("[Discord] failed to assign RSVP role:", err);
    }
  }

  // Confirmation DM with game link
  try {
    const c = await getBotClient();
    const target = await c.users.fetch(userId);
    const lines: string[] = [];
    lines.push(event.dm_message?.trim() || `You're confirmed for **${event.title || "the event"}**!`);
    if (event.event_time_utc) {
      lines.push(`🕐 Event time: ${formatChicago(Number(event.event_time_utc))} (<t:${Math.floor(Number(event.event_time_utc) / 1000)}:R>)`);
    }
    if (event.game_link) lines.push(`🎮 Game link: ${event.game_link}`);
    await target.send(lines.join("\n\n"));
  } catch (err) {
    console.error("[Discord] failed to send RSVP confirmation DM:", err);
  }

  // Update the embed with the live attendee list
  await updateEmbedAttendeeList(event).catch(err =>
    console.error("[Discord] failed to update embed attendee list:", err),
  );
}

export async function processRsvpLeave(event: RsvpEvent, userId: string): Promise<void> {
  await removeAttendee(event.id, userId);
  if (event.auto_assign_role_id) {
    try {
      const guild = await getGuild();
      const member = await guild.members.fetch(userId);
      await member.roles.remove(event.auto_assign_role_id);
    } catch (err) {
      console.error("[Discord] failed to remove RSVP role:", err);
    }
  }
  // Update the embed with the live attendee list
  await updateEmbedAttendeeList(event).catch(err =>
    console.error("[Discord] failed to update embed attendee list after leave:", err),
  );
}

/**
 * Fetches the current attendee list from the DB and edits the original Discord
 * embed message to add/update a "Players (X/max)" field showing who has RSVPed.
 */
export async function updateEmbedAttendeeList(event: RsvpEvent): Promise<void> {
  const guild = await getGuild();
  const channel = await guild.channels.fetch(event.channel_id);
  if (!channel || !channel.isTextBased()) return;

  const message = await (channel as TextChannel).messages.fetch(event.message_id);
  if (!message || !message.embeds[0]) return;

  const attendees = await listAttendees(event.id);
  const count = attendees.length;
  const maxLabel = event.max_attendees ? `/${event.max_attendees}` : "";
  const fieldName = `👥 Players (${count}${maxLabel})`;
  const fieldValue =
    count === 0
      ? "_No one has RSVPed yet. React with ✅ to join!_"
      : attendees
          .map((a, i) => `${i + 1}. ${a.discord_username ? `**${a.discord_username}**` : `<@${a.discord_user_id}>`}`)
          .join("\n");

  // Rebuild the embed from the existing one, replacing/adding the Players field.
  const existing = message.embeds[0];
  const rebuilt = EmbedBuilder.from(existing);

  // Remove any previous Players field, then append the updated one.
  const fields = (existing.fields ?? []).filter(f => !f.name.startsWith("👥 Players"));
  rebuilt.setFields([
    ...fields,
    { name: fieldName, value: fieldValue, inline: false },
  ]);

  await message.edit({ embeds: [rebuilt] });
}

/**
 * Reconcile RSVP state from actual message reactions (covers reactions that occurred
 * while no warm instance was listening on the gateway). Runs during the reminder sweep.
 */
export async function reconcileEventReactions(event: RsvpEvent): Promise<void> {
  try {
    const guild = await getGuild();
    const channel = await guild.channels.fetch(event.channel_id);
    if (!channel || !channel.isTextBased()) return;
    const message = await (channel as TextChannel).messages.fetch(event.message_id);
    // Force-fetch the reaction from Discord (bypasses cache so we always get fresh data)
    const reaction = await message.reactions.resolve(RSVP_EMOJI)?.fetch() ??
      message.reactions.cache.get(RSVP_EMOJI);
    if (!reaction) {
      // No reactions at all — embed still needs the Players field showing 0
      await updateEmbedAttendeeList(event).catch(() => {});
      return;
    }
    const users = await reaction.users.fetch();
    // Build set of actual reactors (excluding bots)
    const reactorIds = new Set<string>();
    for (const [uid, u] of Array.from(users.entries())) {
      if (u.bot) continue;
      reactorIds.add(uid);
    }

    // Add any missing attendees (reacted while cold)
    for (const [uid, u] of Array.from(users.entries())) {
      if (u.bot) continue;
      await addAttendee(event.id, uid, u.username ?? null);
    }

    // Remove attendees who un-reacted while cold (full diff)
    const storedAttendees = await listAttendees(event.id);
    for (const a of storedAttendees) {
      if (!reactorIds.has(a.discord_user_id)) {
        await removeAttendee(event.id, a.discord_user_id);
        // Best-effort role removal
        if (event.auto_assign_role_id) {
          try {
            const member = await guild.members.fetch(a.discord_user_id);
            await member.roles.remove(event.auto_assign_role_id);
          } catch { /* member may have left the server */ }
        }
      }
    }

    // Always sync the embed to reflect current state
    await updateEmbedAttendeeList(event).catch(err =>
      console.error("[Discord] reconcile embed update failed:", err),
    );
  } catch (err) {
    console.error("[Discord] reconcile reactions failed:", err);
  }
}

/**
 * Full sync: iterate ALL active RSVP events, reconcile reactions from Discord,
 * and update each embed's attendee list. Called on bot startup and every 30s.
 * "Active" = event has no event_time_utc OR event_time_utc is in the future or
 * within the last 2 hours (so recently-ended events still sync).
 */
export async function fullSyncAllRsvpEvents(): Promise<void> {
  try {
    const events = await listRsvpEvents();
    const cutoff = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
    const active = events.filter(e => {
      if (!e.event_time_utc) return true; // no time set — always sync
      return Number(e.event_time_utc) > cutoff;
    });
    for (const event of active) {
      await reconcileEventReactions(event);
      // Small delay between events to avoid Discord rate limits
      await new Promise(r => setTimeout(r, 500));
    }
    if (active.length > 0) {
      console.log(`[Discord] Synced reactions for ${active.length} active RSVP event(s)`);
    }
  } catch (err) {
    console.error("[Discord] fullSyncAllRsvpEvents failed:", err);
  }
}

// ---------- Reminders ----------
export async function sendReminderDMs(
  event: RsvpEvent,
  kind: "1h" | "10m" | "start",
): Promise<number> {
  const c = await getBotClient();
  const { listAttendees } = await import("./featureDb");
  const attendees = await listAttendees(event.id);
  const eventTime = event.event_time_utc ? Number(event.event_time_utc) : null;
  const when =
    kind === "1h" ? "in 1 hour" : kind === "10m" ? "in 10 minutes" : "starting NOW";

  const lines: string[] = [
    `⏰ **Reminder:** **${event.title || "Your event"}** is ${when}!`,
  ];
  if (eventTime) {
    lines.push(`🕐 ${formatChicago(eventTime)} (<t:${Math.floor(eventTime / 1000)}:R>)`);
  }
  if (event.game_link) lines.push(`🎮 Game link: ${event.game_link}`);
  const body = lines.join("\n\n");

  let sent = 0;
  for (const a of attendees) {
    try {
      const target = await c.users.fetch(a.discord_user_id);
      await target.send(body);
      sent++;
    } catch (err) {
      console.error(`[Discord] reminder DM failed for ${a.discord_user_id}:`, err);
    }
  }
  return sent;
}
