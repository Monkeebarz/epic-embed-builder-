import { describe, expect, it } from "vitest";
import { createHeartbeatJob, deleteHeartbeatJob, listHeartbeatJobs } from "./_core/heartbeat";

/**
 * Verifies heartbeat cron creation works with owner attribution (empty session),
 * which is how RSVP reminder jobs are scheduled in this admin-password app.
 */
describe("heartbeat scheduling (owner attribution)", () => {
  it("creates, lists, and deletes a cron job with empty user session", async () => {
    const name = `vitest-hb-${Date.now()}`;
    const job = await createHeartbeatJob(
      {
        name,
        cron: "0 0 0 1 1 *", // once a year — will be deleted immediately
        path: "/api/scheduled/rsvpReminder",
        payload: {},
        description: "vitest temp job",
      },
      "",
    );
    expect(job.taskUid).toBeTruthy();

    const listed = await listHeartbeatJobs("");
    expect((listed.jobs ?? []).some(j => j.taskUid === job.taskUid)).toBe(true);

    await deleteHeartbeatJob(job.taskUid, "");
    const after = await listHeartbeatJobs("");
    expect((after.jobs ?? []).some(j => j.taskUid === job.taskUid)).toBe(false);
  }, 30_000);
});
