import { describe, expect, it } from "vitest";

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? "";
const GUILD_ID = process.env.DISCORD_GUILD_ID ?? "";

describe("Discord credentials", () => {
  it("has DISCORD_BOT_TOKEN and DISCORD_GUILD_ID set", () => {
    expect(BOT_TOKEN.length).toBeGreaterThan(0);
    expect(GUILD_ID.length).toBeGreaterThan(0);
  });

  it("bot token authenticates against the Discord API", async () => {
    const res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; username: string };
    expect(body.id).toBeTruthy();
  });

  it("bot can access the configured guild", async () => {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${GUILD_ID}`,
      { headers: { Authorization: `Bot ${BOT_TOKEN}` } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.id).toBe(GUILD_ID);
  });
});
