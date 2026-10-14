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
  mapId: "the-lab",
  state: "planned",
  requesterCapacity: 3,
  sortKey: 1_000_000,
  manualOrder: 0,
  serviceLane: 1,
  serviceKey: 1_000_000,
  nextMoveRaidId: 8,
  automaticFill: true,
  discordCallStatus: "not_requested",
  twitchCallStatus: "not_requested",
  members: [requester],
};

const snapshot: StaffBoardSnapshot = {
  boardVersion: 3,
  raidCount: 11,
  pageNumber: 1,
  raids: [raid],
};
const boardInput = { guildId: "guild", staffChannelId: "staff" };

describe("unified staff board", () => {
  it("shows one compact list with streamer ordering and page controls", () => {
    const message = renderStaffBoard(snapshot, boardInput);
    const text = JSON.stringify(message);
    expect(text).toContain("Page 1");
    expect(text).toContain("Showing 1 of 11 raids (up to 10)");
    expect(text).toContain("Pin to top");
    expect(text).not.toContain(" · Pinned");
    expect(text).toContain("Streamer only");
    expect(text).not.toMatch(/Priority|Ordinary|Attempt|Goal:|Notes:/);
    expect(text).toContain("Requesters: @viewer");
    expect(message.allowed_mentions).toEqual({ parse: [] });
    expect(message.embeds).toHaveLength(1);
    expect(message.components[0]?.components).toMatchObject([
      { label: "Previous", disabled: true },
      { label: "Next", disabled: true },
      { label: "Refresh" },
    ]);
    const pinned = renderStaffBoard(
      { ...snapshot, raids: [{ ...raid, manualOrder: 2 }] },
      boardInput,
    );
    expect(pinned.embeds?.[0]?.fields[0]?.name).toBe("1. PvE · The Lab · Pinned");
    expect(JSON.stringify(pinned)).toContain("Unpin");
    expect(JSON.stringify(pinned)).not.toMatch(/Moved|Move to top|Remove from top/);
    expect(JSON.stringify(pinned)).not.toContain("Pin to top");
    expect(pinned.components).toHaveLength(3);
  });

  it("offers only unpinned planned raids for pinning and pinned planned raids for unpinning", () => {
    const message = renderStaffBoard(
      {
        ...snapshot,
        raids: [
          { ...raid, id: 1, state: "active", manualOrder: 0 },
          { ...raid, id: 2, manualOrder: 4 },
          { ...raid, id: 3, manualOrder: 0 },
        ],
      },
      boardInput,
    );
    const selectors = message.components.flatMap((row) => row.components);
    expect(
      selectors.find(
        (component) => component.type === 3 && component.placeholder === "Review a raid",
      ),
    ).toMatchObject({
      options: [{ value: "2" }, { value: "3" }],
    });
    expect(
      selectors.find(
        (component) =>
          component.type === 3 && component.placeholder === "Pin to top · Streamer only",
      ),
    ).toMatchObject({
      options: [{ value: "3" }],
    });
    expect(
      selectors.find(
        (component) => component.type === 3 && component.placeholder === "Unpin · Streamer only",
      ),
    ).toMatchObject({
      options: [{ value: "2" }],
    });
  });

  it("keeps every full maximum-name raid within Discord field and aggregate limits", () => {
    const raids: StaffBoardRaid[] = Array.from({ length: 10 }, (_, i) => ({
      ...raid,
      id: i + 1,
      gameMode: "pvp-seasonal",
      mapId: "streets-of-tarkov",
      requesterCapacity: 4,
      manualOrder: i + 1,
      leaderDiscordUserId: "9".repeat(25),
      staffMessageId: "8".repeat(25),
      members: Array.from({ length: 4 }, (_, j) => ({
        ...requester,
        id: i * 4 + j + 1,
        requestId: i * 4 + j + 1,
        twitchLogin: j === 0 ? "_".repeat(25) : "_".repeat(24) + String(j),
        position: j + 1,
      })),
    }));
    const message = renderStaffBoard(
      { ...snapshot, raids, raidCount: 100000, pageNumber: 10000 },
      { guildId: "7".repeat(25), staffChannelId: "6".repeat(25) },
    );
    const size = (message.embeds ?? []).reduce(
      (sum, e) =>
        sum +
        e.title.length +
        e.description.length +
        e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0),
      0,
    );
    expect(size).toBeLessThanOrEqual(6000);
    expect(message.embeds?.[0]?.fields).toHaveLength(10);
    for (const field of message.embeds?.[0]?.fields ?? []) {
      expect(field.name.length).toBeLessThanOrEqual(256);
      expect(field.value.length).toBeLessThanOrEqual(1024);
      expect(field.value).toContain(`@${"\\_".repeat(25)}`);
    }
    expect(message.components.length).toBeLessThanOrEqual(5);
  });

  it("encodes only bounded navigation and parses current order controls", () => {
    const target = {
      direction: "next" as const,
      boundary: { lane: 1 as const, key: -3, id: 7 },
      pageNumber: 2,
    };
    const message = renderStaffBoard({ ...snapshot, nextPage: target }, boardInput);
    const next = message.components[0]?.components[1];
    if (next?.type !== 2 || next.custom_id === undefined) throw new Error("Missing next button");
    expect(parseStaffBoardAction(next.custom_id)).toEqual({ action: "page", version: 3, target });
    expect(next.custom_id.length).toBeLessThanOrEqual(100);
    expect(parseStaffBoardAction("board:v7:move:3")).toEqual({ action: "move", version: 3 });
    expect(parseStaffBoardAction("board:v7:page:3:next:1:-3:7:0")).toBeUndefined();
    expect(parseStaffBoardAction("board:v7:page:9007199254740992:next:1:1:7:2")).toBeUndefined();
  });

  it("renders planned review details without calls or active-only controls", () => {
    const reviewed = { ...raid, automaticFill: false, staffMessageId: "review-message" };
    const pullSource = { ...raid, id: 8, sortKey: 2_000_000 };
    const message = renderRaidMessage(reviewed, "reviewer", pullSource);
    const serialized = JSON.stringify(message);
    expect(serialized).toContain("Status: Planned review");
    expect(serialized).toContain("Leader: Not assigned");
    expect(serialized).toContain("Calls: No requesters have been called.");
    expect(serialized).toContain("Goal: Task");
    expect(serialized).toContain("Notes: Bring markers");
    expect(serialized).toContain("Call and start raid");
    expect(serialized).toContain("Pull requester up");
    expect(serialized).toContain("raid:v4:pull:7:8");
    expect(serialized).not.toContain("raid:v4:pull_candidates:7");
    expect(serialized).toContain("Move requester to next raid");
    expect(serialized).toContain("raid:v4:move:7:8");
    expect(serialized).toContain("Remove requester");
    expect(serialized).toContain('"label":"Cancel review"');
    expect(serialized).toContain("raid:v4:cancel:7");
    expect(message.components[0]?.components).toMatchObject([
      { label: "Call and start raid", style: 1 },
      { label: "Cancel review", style: 2 },
    ]);
    expect(message.components).toHaveLength(4);
    expect(serialized).not.toContain("Record a raid result");
    expect(serialized).not.toContain("Postpone raid");
    expect(message.content).toBe("<@reviewer> review this proposed raid.");
    expect(message.allowed_mentions.users).toEqual(["reviewer"]);
  });

  it("hides planned movement without a destination and preserves active postponement", () => {
    const withoutDestination = { ...raid };
    delete withoutDestination.nextMoveRaidId;
    const reviewed = renderRaidMessage({
      ...withoutDestination,
      automaticFill: false,
    });
    expect(JSON.stringify(reviewed)).not.toContain("Move requester to next raid");
    expect(JSON.stringify(reviewed)).toContain("Remove requester");
    const active = renderRaidMessage({ ...withoutDestination, state: "active" });
    expect(JSON.stringify(active)).toContain("Postpone requester");
  });

  it("shows Pull requester up in reviewed or active raids with capacity", () => {
    const pullSource = { ...raid, id: 8, sortKey: 2_000_000 };
    expect(JSON.stringify(renderRaidMessage(raid))).not.toContain("Pull requester up");
    expect(
      JSON.stringify(
        renderRaidMessage(
          { ...raid, automaticFill: false, staffMessageId: "review-message" },
          undefined,
          pullSource,
        ),
      ),
    ).toContain("Pull requester up");
    expect(
      JSON.stringify(
        renderRaidMessage({ ...raid, automaticFill: false, staffMessageId: "review-message" }),
      ),
    ).toContain("Pull requester up");
    expect(
      renderRaidMessage({ ...raid, automaticFill: false, staffMessageId: "review-message" })
        .components[1]?.components[0],
    ).toMatchObject({
      placeholder: "Pull requester up",
      disabled: true,
      options: [{ label: "No compatible requester available", value: "unavailable" }],
    });
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
          undefined,
          pullSource,
        ),
      ),
    ).toContain("Pull requester up");
  });

  it.each(["planned", "active"] as const)(
    "keeps %s source navigation within five Discord rows",
    (state) => {
      const message = renderRaidMessage({ ...raid, state, automaticFill: false }, undefined, {
        ...raid,
        id: 8,
        previousSourceId: 6,
        nextSourceId: 9,
      });
      expect(message.components).toHaveLength(5);
      expect(JSON.stringify(message)).toContain("raid:v4:pull_page:7:6");
      expect(JSON.stringify(message)).toContain("raid:v4:pull_page:7:9");
      expect(JSON.stringify(message)).toContain("Pull requester up");
      expect(parseRaidMessageAction("raid:v4:pull_page:7:9")).toEqual({
        action: "pull_page",
        raidId: 7,
        sourceRaidId: 9,
      });
    },
  );

  it("renders full raid disclosure without attempt recording", () => {
    const active = {
      ...raid,
      state: "active" as const,
      leaderDiscordUserId: "leader",
      leaderType: "volunteer" as const,
      discordCallStatus: "sent" as const,
    };
    const message = renderRaidMessage(active, "leader");
    expect(JSON.stringify(message)).toContain("PvE · The Lab raid");
    expect(JSON.stringify(message)).toContain("Goal: Task");
    expect(JSON.stringify(message)).toContain("Notes: Bring markers");
    expect(JSON.stringify(message)).not.toContain("Record unsuccessful attempt");
    expect(JSON.stringify(message)).toContain("Postpone requester");
    expect(JSON.stringify(message)).toContain("Remove requester");
    expect(JSON.stringify(message)).toContain("Postpone raid");
    expect(JSON.stringify(message)).not.toContain("Call and start raid");
    expect(JSON.stringify(message)).not.toContain("Pull requester up");
    expect(JSON.stringify(message)).not.toContain('"label":"Cancel review"');
    expect(message.allowed_mentions.users).toEqual(["leader"]);
    const updated = renderRaidMessage({ ...active });
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
    const message = renderRaidMessage(maximum);
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
    const message = renderRaidMessage(destination, undefined, source);
    expect(message.components[1]?.components[0]).toMatchObject({
      custom_id: "raid:v4:pull:7:8",
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
    expect(parseStaffBoardAction("board:v7:review")).toEqual({ action: "review" });
    expect(parseStaffBoardAction("board:v5:refresh")).toEqual({ action: "refresh" });
    expect(parseStaffBoardAction("board:v5:start")).toEqual({ action: "retired_start" });
    expect(parseStaffBoardAction("board:v4:refresh")).toBeUndefined();
    expect(parseStaffBoardAction("staff:v3:end:4")).toBeUndefined();
    expect(parseRaidMessageAction("raid:v2:call:7")).toEqual({ action: "call", raidId: 7 });
    expect(parseRaidMessageAction("raid:v4:move:7:8")).toEqual({
      action: "move",
      raidId: 7,
      destinationRaidId: 8,
    });
    expect(parseRaidMessageAction("raid:v4:move:7:0")).toBeUndefined();
    expect(parseRaidMessageAction("raid:v4:move:7:9007199254740992")).toBeUndefined();
    expect(parseRaidMessageAction("raid:v4:pull_candidates:7")).toEqual({
      action: "pull_candidates",
      raidId: 7,
    });
    expect(parseRaidMessageAction("raid:v4:pull:7:8")).toEqual({
      action: "pull",
      raidId: 7,
      sourceRaidId: 8,
    });
    expect(parseRaidMessageAction("raid:v4:cancel:7")).toEqual({
      action: "cancel",
      raidId: 7,
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
