import { describe, expect, it } from "vitest";
import type { StaffBoardRaid, StaffBoardSnapshot } from "../../src/domain/staff-board";
import {
  parseRaidMessageAction,
  parseStaffBoardAction,
  renderRaidMessage,
  renderStaffBoard,
} from "../../src/infrastructure/discord/staff-board";

const raid: StaffBoardRaid = {
  gameMode: "pve",
  id: 7,
  queueKind: "ordinary",
  mapId: "the-lab",
  state: "planned",
  requesterCapacity: 3,
  sortKey: 1_000_000,
  automaticFill: true,
  attemptCount: 0,
  discordCallStatus: "not_requested",
  twitchCallStatus: "not_requested",
  members: [
    {
      id: 9,
      requestId: 2,
      twitchLogin: "viewer",
      inGameName: "PMC Name",
      discordUserId: "discord-viewer",
      objective: "Task",
      notes: "Bring markers",
      position: 1,
    },
  ],
};

const snapshot: StaffBoardSnapshot = {
  priorityRaidCount: 0,
  ordinaryRaidCount: 11,
  priorityRaids: [],
  ordinaryRaids: [raid],
};

describe("split staff board", () => {
  it("renders compact raid state with only Refresh and Start a raid", () => {
    const message = renderStaffBoard(snapshot, {
      attemptLimit: 3,
      guildId: "guild",
      staffChannelId: "staff",
    });
    const serialized = JSON.stringify(message);
    expect(serialized).not.toContain("help requests");
    expect(serialized).not.toContain("raids outstanding");
    expect(serialized).toContain("Priority raids");
    expect(serialized).toContain("Ordinary raids");
    expect(serialized).toContain("Showing 0 of 0 raids (up to 3)");
    expect(serialized).toContain("Showing 1 of 11 raids (up to 7)");
    expect(serialized).toContain("board:v5:refresh");
    expect(serialized).toContain("board:v5:start");
    expect(serialized).toContain("PvE · The Lab");
    expect(
      JSON.stringify(
        renderStaffBoard(
          { ...snapshot, ordinaryRaids: [{ ...raid, staffMessageId: "obsolete-message" }] },
          { attemptLimit: 3, guildId: "guild", staffChannelId: "staff" },
        ),
      ),
    ).not.toContain("obsolete-message");
    expect(serialized).not.toContain("schedule");
    expect(serialized).not.toMatch(/Pause|End night|Reassign|Previous|Next page|Goal:|Notes:/);
    expect(message.allowed_mentions).toEqual({ parse: [] });
  });

  it("derives start-selector ordinals before active raids are removed", () => {
    const message = renderStaffBoard(
      {
        ...snapshot,
        ordinaryRaids: [{ ...raid, id: 6, state: "active", leaderDiscordUserId: "leader" }, raid],
      },
      { attemptLimit: 3, guildId: "guild", staffChannelId: "staff" },
    );
    expect(JSON.stringify(message)).toContain("Ordinary 2 · PvE · The Lab");
    expect(JSON.stringify(message)).not.toContain("Ordinary 1 · PvE · The Lab");
  });

  it("renders full raid disclosure and the attempt-dependent controls", () => {
    const active = {
      ...raid,
      state: "active" as const,
      leaderDiscordUserId: "leader",
      leaderType: "volunteer" as const,
      attemptCount: 2,
      discordCallStatus: "sent" as const,
    };
    const message = renderRaidMessage(active, 3, true);
    expect(JSON.stringify(message)).toContain("PvE · The Lab raid");
    expect(JSON.stringify(message)).toContain("Goal: Task");
    expect(JSON.stringify(message)).toContain("Notes: Bring markers");
    expect(JSON.stringify(message)).toContain("Record unsuccessful attempt");
    expect(JSON.stringify(message)).toContain("Postpone requester");
    expect(JSON.stringify(message)).toContain("Remove requester");
    expect(JSON.stringify(message)).toContain("Postpone raid");
    expect(message.allowed_mentions.users).toEqual(["leader"]);
    const updated = renderRaidMessage({ ...active, attemptCount: 3 }, 3);
    expect(JSON.stringify(updated)).not.toContain("Try again");
    expect(JSON.stringify(updated)).not.toContain("Record unsuccessful attempt");
    expect(JSON.stringify(updated)).toContain("Postpone raid");
    expect(updated.content).toBe("<@leader> this raid is ready.");
    expect(updated.allowed_mentions).toEqual({ parse: [] });
  });

  it("accepts only current board and raid component IDs", () => {
    expect(parseStaffBoardAction("board:v5:refresh")).toEqual({ action: "refresh" });
    expect(parseStaffBoardAction("board:v4:refresh")).toBeUndefined();
    expect(parseStaffBoardAction("staff:v3:end:4")).toBeUndefined();
    expect(parseRaidMessageAction("raid:v1:result:7")).toEqual({ action: "result", raidId: 7 });
    expect(parseRaidMessageAction("raid:v1:postpone:7")).toEqual({
      action: "postpone",
      raidId: 7,
    });
    expect(parseRaidMessageAction("raid:v1:remove:7")).toEqual({
      action: "remove",
      raidId: 7,
    });
  });
});
