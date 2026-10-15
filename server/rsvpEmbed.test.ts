import { describe, expect, it } from "vitest";
import { buildEmbed, buildRsvpAttendeeField } from "./discordBot";

describe("RSVP attendee embed field", () => {
  it("shows an empty player list in the initial RSVP embed without decorative checkmarks", () => {
    const embed = buildEmbed({
      title: "Poker Night",
      description: "Join us",
      color: "#6A0DAD",
      thumbnailUrl: null,
      imageUrl: null,
      footerText: null,
      eventTimeUtc: null,
      channelId: "channel",
      rolePingIds: [],
      rsvpEnabled: true,
      maxAttendees: 8,
      rsvpDeadlineUtc: null,
    }).toJSON();

    expect(embed.fields?.some(field => field.name === "👥 Players (0/8)")).toBe(true);
    expect(JSON.stringify(embed)).not.toContain("✅");
    expect(embed.fields?.some(field => field.name === "🎟️ RSVP" && field.value.includes("React below"))).toBe(true);
  });

  it("renders the attendee list and cap from stored RSVPs", () => {
    const field = buildRsvpAttendeeField([
      { discord_user_id: "u1", discord_username: "PlayerOne" },
      { discord_user_id: "u2", discord_username: null },
    ], 8);

    expect(field.name).toBe("👥 Players (2/8)");
    expect(field.value).toContain("**PlayerOne**");
    expect(field.value).toContain("<@u2>");
    expect(field.value).not.toContain("✅");
  });
});
