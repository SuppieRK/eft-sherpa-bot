import { describe, expect, it } from "vitest";
import type { StaffBoardRaid, StaffBoardSnapshot } from "../../src/domain/staff-board";
import {
  parseRaidMessageAction,
  parseStaffBoardAction,
  renderRaidMessage,
  renderStaffBoard,
} from "../../src/infrastructure/discord/staff-board";

const requester: StaffBoardRaid["members"][number] = {
  id: 9,
  requestId: 2,
  twitchLogin: "viewer",
  inGameName: "PMC Name",
  discordUserId: "discord-viewer",
  objective: "Task",
  notes: "Bring markers",
  position: 1,
};

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
  members: [requester],
};

const snapshot: StaffBoardSnapshot = {
  priorityRaidCount: 0,
  ordinaryRaidCount: 11,
  priorityRaids: [],
  ordinaryRaids: [raid],
};

describe("split staff board", () => {
  it("renders compact raid state with only Refresh and Review a raid", () => {
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
    expect(serialized).toContain("board:v6:refresh");
    expect(serialized).toContain("board:v6:review");
    expect(serialized).toContain("Review a raid");
    expect(serialized).toContain("PvE · The Lab");
    expect(serialized).toContain("Requesters: @viewer");
    expect(serialized).not.toContain("PvE · The Lab (2/5)");
    expect(
      JSON.stringify(
        renderStaffBoard(
          { ...snapshot, ordinaryRaids: [{ ...raid, staffMessageId: "obsolete-message" }] },
          { attemptLimit: 3, guildId: "guild", staffChannelId: "staff" },
        ),
      ),
    ).toContain("obsolete-message");
    expect(serialized).not.toContain("schedule");
    expect(serialized).not.toMatch(/Pause|End night|Reassign|Previous|Next page|Goal:|Notes:/);
    expect(message.allowed_mentions).toEqual({ parse: [] });
  });

  it("lists every grouped requester without a leader-inclusive occupancy fraction", () => {
    const grouped = {
      ...raid,
      members: Array.from({ length: 4 }, (_, index) => ({
        ...requester,
        id: index + 1,
        requestId: index + 1,
        twitchLogin: `viewer_${index + 1}`,
        position: index + 1,
      })),
    };
    const message = renderStaffBoard(
      { ...snapshot, ordinaryRaids: [grouped] },
      { attemptLimit: 3, guildId: "guild", staffChannelId: "staff" },
    );
    const serialized = JSON.stringify(message);
    expect(message.embeds?.[1]?.fields[0]?.value).toContain(
      "Requesters: @viewer\\_1 · @viewer\\_2 · @viewer\\_3 · @viewer\\_4",
    );
    expect(serialized).not.toContain("(5/5)");
    expect(message.allowed_mentions).toEqual({ parse: [] });
  });

  it("keeps a maximum ten-raid board within the Discord embed limit", () => {
    const raids = Array.from({ length: 10 }, (_, raidIndex) => ({
      ...raid,
      id: raidIndex + 1,
      members: Array.from({ length: 4 }, (_, memberIndex) => ({
        ...requester,
        id: raidIndex * 4 + memberIndex + 1,
        requestId: raidIndex * 4 + memberIndex + 1,
        twitchLogin: `viewer${raidIndex}${memberIndex}${"x".repeat(16)}`,
        position: memberIndex + 1,
      })),
    }));
    const message = renderStaffBoard(
      {
        priorityRaidCount: 3,
        ordinaryRaidCount: 7,
        priorityRaids: raids.slice(0, 3).map((item) => ({
          ...item,
          queueKind: "priority" as const,
        })),
        ordinaryRaids: raids.slice(3),
      },
      { attemptLimit: 3, guildId: "guild", staffChannelId: "staff" },
    );
    const embedCharacters = (message.embeds ?? []).reduce(
      (total, embed) =>
        total +
        embed.title.length +
        embed.description.length +
        embed.fields.reduce(
          (fieldTotal, field) => fieldTotal + field.name.length + field.value.length,
          0,
        ),
      0,
    );
    expect(embedCharacters).toBeLessThanOrEqual(6_000);
    for (const item of raids) {
      for (const member of item.members)
        expect(JSON.stringify(message)).toContain(member.twitchLogin);
    }
  });

  it("derives review-selector ordinals before active raids are removed", () => {
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

  it("renders planned review details without calls or active-only controls", () => {
    const reviewed = { ...raid, automaticFill: false, staffMessageId: "review-message" };
    const pullSource = { ...raid, id: 8, sortKey: 2_000_000 };
    const message = renderRaidMessage(reviewed, 3, "reviewer", pullSource);
    const serialized = JSON.stringify(message);
    expect(serialized).toContain("Status: Planned review · Attempt 0/3");
    expect(serialized).toContain("Leader: Not assigned");
    expect(serialized).toContain("Calls: No requesters have been called.");
    expect(serialized).toContain("Goal: Task");
    expect(serialized).toContain("Notes: Bring markers");
    expect(serialized).toContain("Call and start raid");
    expect(serialized).toContain("Pull requester up");
    expect(serialized).toContain("raid:v3:pull:7:8");
    expect(serialized).not.toContain("raid:v3:pull_candidates:7");
    expect(serialized).toContain("Move requester to next raid");
    expect(serialized).toContain("Remove requester");
    expect(serialized).not.toContain("Record a raid result");
    expect(serialized).not.toContain("Postpone raid");
    expect(message.content).toBe("<@reviewer> review this proposed raid.");
    expect(message.allowed_mentions.users).toEqual(["reviewer"]);
  });

  it("shows Pull requester up only during a planned frozen review with capacity", () => {
    const pullSource = { ...raid, id: 8, sortKey: 2_000_000 };
    expect(JSON.stringify(renderRaidMessage(raid, 3))).not.toContain("Pull requester up");
    expect(
      JSON.stringify(
        renderRaidMessage(
          { ...raid, automaticFill: false, staffMessageId: "review-message" },
          3,
          undefined,
          pullSource,
        ),
      ),
    ).toContain("Pull requester up");
    expect(
      JSON.stringify(
        renderRaidMessage({ ...raid, automaticFill: false, staffMessageId: "review-message" }, 3),
      ),
    ).not.toContain("Pull requester up");
    expect(
      JSON.stringify(
        renderRaidMessage(
          {
            ...raid,
            automaticFill: false,
            staffMessageId: "full-review-message",
            members: Array.from({ length: raid.requesterCapacity }, (_, index) => ({
              ...requester,
              id: index + 1,
              requestId: index + 1,
              position: index + 1,
            })),
          },
          3,
          undefined,
          pullSource,
        ),
      ),
    ).not.toContain("Pull requester up");
    expect(
      JSON.stringify(
        renderRaidMessage(
          {
            ...raid,
            state: "active",
            automaticFill: false,
            staffMessageId: "active-message",
            leaderDiscordUserId: "leader",
          },
          3,
          undefined,
          pullSource,
        ),
      ),
    ).not.toContain("Pull requester up");
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
    const message = renderRaidMessage(active, 3, "leader");
    expect(JSON.stringify(message)).toContain("PvE · The Lab raid");
    expect(JSON.stringify(message)).toContain("Goal: Task");
    expect(JSON.stringify(message)).toContain("Notes: Bring markers");
    expect(JSON.stringify(message)).toContain("Record unsuccessful attempt");
    expect(JSON.stringify(message)).toContain("Postpone requester");
    expect(JSON.stringify(message)).toContain("Remove requester");
    expect(JSON.stringify(message)).toContain("Postpone raid");
    expect(JSON.stringify(message)).not.toContain("Call and start raid");
    expect(JSON.stringify(message)).not.toContain("Pull requester up");
    expect(message.allowed_mentions.users).toEqual(["leader"]);
    const updated = renderRaidMessage({ ...active, attemptCount: 3 }, 3);
    expect(JSON.stringify(updated)).not.toContain("Try again");
    expect(JSON.stringify(updated)).not.toContain("Record unsuccessful attempt");
    expect(JSON.stringify(updated)).toContain("Postpone raid");
    expect(updated.content).toBe("<@leader> this raid is ready.");
    expect(updated.allowed_mentions).toEqual({ parse: [] });
  });

  it("keeps a full four-requester review within the Discord embed limit", () => {
    const maximum = {
      ...raid,
      requesterCapacity: 4,
      automaticFill: false,
      members: Array.from({ length: 4 }, (_, index) => ({
        id: index + 1,
        requestId: index + 1,
        twitchLogin: `viewer_${"x".repeat(17)}${index}`,
        inGameName: "E".repeat(64),
        discordUserId: String(1_000_000_000_000_000_000n + BigInt(index)),
        objective: "G".repeat(150),
        notes: "N".repeat(250),
        position: index + 1,
      })),
    };
    const message = renderRaidMessage(maximum, 3);
    const embedCharacters = (message.embeds ?? []).reduce(
      (total, embed) =>
        total +
        embed.title.length +
        embed.description.length +
        embed.fields.reduce(
          (fieldTotal, field) => fieldTotal + field.name.length + field.value.length,
          0,
        ),
      0,
    );
    expect(embedCharacters).toBeLessThanOrEqual(6_000);
    expect(JSON.stringify(message)).not.toContain("Pull requester up");
  });

  it("labels pull candidates with Twitch nicknames and describes them with goals", () => {
    const destination = { ...raid, automaticFill: false, staffMessageId: "review-message" };
    const source = {
      ...raid,
      id: 8,
      sortKey: 2_000_000,
      members: [
        requester,
        {
          ...requester,
          id: 10,
          requestId: 3,
          twitchLogin: "chosen_viewer",
          objective: "Reach the IceBreaker bridge",
          position: 2,
        },
      ],
    };
    const message = renderRaidMessage(destination, 3, undefined, source);
    expect(message.components[1]?.components[0]).toMatchObject({
      custom_id: "raid:v3:pull:7:8",
      options: [
        { label: "@viewer", description: "Task", value: "2" },
        {
          label: "@chosen_viewer",
          description: "Reach the IceBreaker bridge",
          value: "3",
        },
      ],
    });
  });

  it("accepts only current board and raid component IDs", () => {
    expect(parseStaffBoardAction("board:v6:refresh")).toEqual({ action: "refresh" });
    expect(parseStaffBoardAction("board:v6:review")).toEqual({ action: "review" });
    expect(parseStaffBoardAction("board:v5:refresh")).toEqual({ action: "refresh" });
    expect(parseStaffBoardAction("board:v5:start")).toEqual({ action: "retired_start" });
    expect(parseStaffBoardAction("board:v4:refresh")).toBeUndefined();
    expect(parseStaffBoardAction("staff:v3:end:4")).toBeUndefined();
    expect(parseRaidMessageAction("raid:v2:call:7")).toEqual({ action: "call", raidId: 7 });
    expect(parseRaidMessageAction("raid:v3:pull_candidates:7")).toEqual({
      action: "pull_candidates",
      raidId: 7,
    });
    expect(parseRaidMessageAction("raid:v3:pull:7:8")).toEqual({
      action: "pull",
      raidId: 7,
      sourceRaidId: 8,
    });
    expect(parseRaidMessageAction("raid:v2:result:7")).toEqual({ action: "result", raidId: 7 });
    expect(parseRaidMessageAction("raid:v2:postpone:7")).toEqual({
      action: "postpone",
      raidId: 7,
    });
    expect(parseRaidMessageAction("raid:v2:remove:7")).toEqual({
      action: "remove",
      raidId: 7,
    });
    expect(parseRaidMessageAction("raid:v1:result:7")).toEqual({ action: "result", raidId: 7 });
  });
});
