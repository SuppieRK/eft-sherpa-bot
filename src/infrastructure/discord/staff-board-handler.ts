import type { CommunityConfig } from "../../config/community";
import { resolveTarkovMap } from "../../domain/maps/catalog";
import { appendRaidBringSuffix } from "../../domain/raid-call";
import { formatModeMap } from "../../domain/game-mode";
import { RepositoryInvariantError } from "../../domain/sherpa-repository";
import { isStaffBoardMember, type StaffBoardRaid } from "../../domain/staff-board";
import { D1MvpRepository } from "../cloudflare/d1-mvp-repository";
import type { CloudflareEnvironment } from "../cloudflare/environment";
import { sendTwitchChatMessage } from "../twitch/twitch-api";
import {
  DISCORD_EPHEMERAL_MESSAGE_FLAG,
  DISCORD_INTERACTION_RESPONSE_CHANNEL_MESSAGE,
  DISCORD_INTERACTION_RESPONSE_UPDATE_MESSAGE,
  type DiscordApplicationCommandInteraction,
  type DiscordMessageComponentInteraction,
} from "./interactions";
import {
  createDiscordMessage,
  deleteDiscordMessage,
  DiscordApiError,
  discordMessageUrl,
  updateDiscordMessage,
} from "./messages";
import {
  parseRaidMessageAction,
  parseStaffBoardAction,
  renderPullRequesterSelector,
  renderRaidMessage,
  renderStaffBoard,
  type DiscordBotMessage,
  type RaidMessageAction,
} from "./staff-board";

type StaffInteraction = Pick<
  DiscordApplicationCommandInteraction,
  "discordUserId" | "discordRoleIds" | "channelId"
>;

export interface StaffBoardHandlerDependencies {
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  changedAt: Date;
  context?: ExecutionContext;
}

function ephemeral(content: string): Response {
  return Response.json({
    type: DISCORD_INTERACTION_RESPONSE_CHANNEL_MESSAGE,
    data: { content, flags: DISCORD_EPHEMERAL_MESSAGE_FLAG, allowed_mentions: { parse: [] } },
  });
}

function ephemeralMessage(message: DiscordBotMessage): Response {
  return Response.json({
    type: DISCORD_INTERACTION_RESPONSE_CHANNEL_MESSAGE,
    data: { ...message, flags: DISCORD_EPHEMERAL_MESSAGE_FLAG },
  });
}

function update(message: DiscordBotMessage): Response {
  return Response.json({ type: DISCORD_INTERACTION_RESPONSE_UPDATE_MESSAGE, data: message });
}

function hasAccess(interaction: StaffInteraction, config: CommunityConfig): boolean {
  return (
    interaction.channelId === config.discord.staffChannelId &&
    isStaffBoardMember({
      discordUserId: interaction.discordUserId,
      discordRoleIds: interaction.discordRoleIds,
      streamerDiscordUserId: config.discord.streamerUserId,
      volunteerRoleId: config.discord.volunteerRoleId,
    })
  );
}

function selectedValue(interaction: DiscordMessageComponentInteraction): string {
  const value = interaction.values[0];
  if (value === undefined) throw new RepositoryInvariantError("Choose an available action.");
  return value;
}

function boardMessage(
  snapshot: Awaited<ReturnType<D1MvpRepository["getBoardSnapshot"]>>,
  config: CommunityConfig,
): DiscordBotMessage {
  return renderStaffBoard(snapshot, {
    attemptLimit: config.policies.attemptLimit,
    guildId: config.discord.guildId,
    staffChannelId: config.discord.staffChannelId,
  });
}

async function raidDetailMessage(input: {
  raid: StaffBoardRaid;
  repository: D1MvpRepository;
  communityConfig: CommunityConfig;
  notificationUserId?: string;
}): Promise<DiscordBotMessage> {
  const canPull =
    input.raid.state === "planned" &&
    !input.raid.automaticFill &&
    input.raid.members.length < input.raid.requesterCapacity;
  const candidates = canPull
    ? await input.repository.getPullRequesterCandidates(input.raid.id, {
        requireStaffMessage: false,
      })
    : undefined;
  return renderRaidMessage(
    input.raid,
    input.communityConfig.policies.attemptLimit,
    input.notificationUserId,
    candidates?.source,
  );
}

export async function synchronizeCanonicalBoard(input: {
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  changedAt: Date;
  createIfMissing: boolean;
}): Promise<string | undefined> {
  const repository = new D1MvpRepository(input.environment.DB);
  const snapshot = await repository.getBoardSnapshot(input.changedAt);
  const message = boardMessage(snapshot, input.communityConfig);
  if (snapshot.canonicalMessageId !== undefined) {
    try {
      await updateDiscordMessage(
        input.environment,
        input.communityConfig.discord.staffChannelId,
        snapshot.canonicalMessageId,
        message,
      );
      return snapshot.canonicalMessageId;
    } catch (error) {
      if (!(error instanceof DiscordApiError) || error.status !== 404 || !input.createIfMissing) {
        throw error;
      }
    }
  } else if (!input.createIfMissing) {
    return undefined;
  }
  const created = await createDiscordMessage(
    input.environment,
    input.communityConfig.discord.staffChannelId,
    message,
  );
  await repository.setCanonicalBoardMessage({
    messageId: created.id,
    changedAt: input.changedAt,
  });
  return created.id;
}

async function deleteDuplicateRaidMessage(input: {
  environment: CloudflareEnvironment;
  channelId: string;
  messageId: string;
}): Promise<void> {
  try {
    await deleteDiscordMessage(input.environment, input.channelId, input.messageId);
  } catch {
    // The compare-and-set winner remains canonical even if Discord rejects duplicate cleanup.
  }
}

async function reconcileRaidMessage(input: {
  raid: StaffBoardRaid;
  repository: D1MvpRepository;
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  changedAt: Date;
}): Promise<void> {
  const current = await input.repository.getRaid(input.raid.id);
  const isReviewedPlanned = current?.state === "planned" && !current.automaticFill;
  if (current === undefined || (current.state !== "active" && !isReviewedPlanned)) return;
  const channelId = input.communityConfig.discord.staffChannelId;
  const message = await raidDetailMessage({
    raid: current,
    repository: input.repository,
    communityConfig: input.communityConfig,
  });
  if (current.staffMessageId !== undefined) {
    try {
      await updateDiscordMessage(input.environment, channelId, current.staffMessageId, message);
      return;
    } catch (error) {
      if (!(error instanceof DiscordApiError) || error.status !== 404) return;
    }
    if (current.state === "planned") {
      await input.repository.compareAndSetRaidStaffMessage({
        groupId: current.id,
        expectedMessageId: current.staffMessageId,
        changedAt: input.changedAt,
      });
      return;
    }
  }
  const created = await createDiscordMessage(input.environment, channelId, message);
  try {
    const stored = await input.repository.compareAndSetRaidStaffMessage({
      groupId: current.id,
      ...(current.staffMessageId === undefined
        ? {}
        : { expectedMessageId: current.staffMessageId }),
      messageId: created.id,
      changedAt: input.changedAt,
    });
    if (!stored) {
      await deleteDuplicateRaidMessage({
        environment: input.environment,
        channelId,
        messageId: created.id,
      });
    }
  } catch (error) {
    await deleteDuplicateRaidMessage({
      environment: input.environment,
      channelId,
      messageId: created.id,
    });
    throw error;
  }
}

async function reconcileVisibleRaidMessages(input: {
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  changedAt: Date;
}): Promise<void> {
  const repository = new D1MvpRepository(input.environment.DB);
  const snapshot = await repository.getBoardSnapshot(input.changedAt);
  const visibleRaids = [...snapshot.priorityRaids, ...snapshot.ordinaryRaids].filter(
    (raid) => raid.state === "active" || raid.staffMessageId !== undefined,
  );
  await Promise.allSettled(
    visibleRaids.map((raid) =>
      reconcileRaidMessage({
        ...input,
        raid,
        repository,
      }),
    ),
  );
  await synchronizeCanonicalBoard({ ...input, createIfMissing: false });
}

async function sendRaidCalls(
  raid: StaffBoardRaid,
  dependencies: StaffBoardHandlerDependencies,
  repository: D1MvpRepository,
): Promise<void> {
  const { environment, communityConfig, changedAt } = dependencies;
  const resolvedMap = resolveTarkovMap(raid.mapId);
  const mapName = resolvedMap?.name ?? raid.mapId;
  const raidName = formatModeMap(raid.gameMode, mapName);
  const linkedUsers = [
    ...(raid.leaderDiscordUserId === undefined ? [] : [raid.leaderDiscordUserId]),
    ...raid.members.flatMap((member) =>
      member.discordUserId === undefined ? [] : [member.discordUserId],
    ),
  ];
  const uniqueUsers = [...new Set(linkedUsers)];
  const unlinkedNames = raid.members
    .filter((member) => member.discordUserId === undefined)
    .map((member) => `@${member.twitchLogin}`);
  const discordMentions = [...uniqueUsers.map((id) => `<@${id}>`), ...unlinkedNames].join(" ");
  const twitchMentions = raid.members.map((member) => `@${member.twitchLogin}`).join(" ");
  try {
    await createDiscordMessage(environment, communityConfig.discord.requestChannelId, {
      content: appendRaidBringSuffix(`Starting ${raidName}: ${discordMentions}`, resolvedMap),
      allowed_mentions: { parse: [], users: uniqueUsers },
    });
    await repository.updateCallStatus(raid.id, "discord", "sent", changedAt);
  } catch {
    await repository.updateCallStatus(raid.id, "discord", "failed", changedAt);
  }
  if (raid.twitchCallStatus !== "pending") return;
  try {
    await sendTwitchChatMessage(
      environment,
      {
        clientId: communityConfig.twitch.clientId,
        botUserId: communityConfig.twitch.botUserId,
      },
      {
        broadcasterId: communityConfig.twitch.broadcasterUserId,
        message: appendRaidBringSuffix(
          `Starting ${raidName}: ${twitchMentions}. Check Discord for details.`,
          resolvedMap,
        ),
      },
    );
    await repository.updateCallStatus(raid.id, "twitch", "sent", changedAt);
  } catch {
    await repository.updateCallStatus(raid.id, "twitch", "failed", changedAt);
  }
}

class StaffBoardHandler {
  private readonly repository: D1MvpRepository;

  constructor(private readonly dependencies: StaffBoardHandlerDependencies) {
    this.repository = new D1MvpRepository(dependencies.environment.DB);
  }

  private async materialize(): Promise<void> {
    await this.repository.materializeWaitingRequests({
      changedAt: this.dependencies.changedAt,
      recipientLimit: this.dependencies.communityConfig.policies.recipientLimit,
    });
  }

  private refreshBoardLater(): void {
    const work = synchronizeCanonicalBoard({
      environment: this.dependencies.environment,
      communityConfig: this.dependencies.communityConfig,
      changedAt: this.dependencies.changedAt,
      createIfMissing: false,
    }).catch(() => undefined);
    this.dependencies.context?.waitUntil(work);
  }

  private reconcileBoardLater(): void {
    const work = reconcileVisibleRaidMessages(this.dependencies).catch(() => undefined);
    this.dependencies.context?.waitUntil(work);
  }

  private async ensureReviewMessage(
    raid: StaffBoardRaid,
    reviewerDiscordUserId: string,
  ): Promise<string | undefined> {
    const { communityConfig, changedAt, environment } = this.dependencies;
    const message = await raidDetailMessage({
      raid,
      repository: this.repository,
      communityConfig,
      notificationUserId: reviewerDiscordUserId,
    });
    if (raid.staffMessageId !== undefined) {
      try {
        await updateDiscordMessage(
          environment,
          communityConfig.discord.staffChannelId,
          raid.staffMessageId,
          message,
        );
        return raid.staffMessageId;
      } catch (error) {
        if (!(error instanceof DiscordApiError) || error.status !== 404) throw error;
      }
      await this.repository.compareAndSetRaidStaffMessage({
        groupId: raid.id,
        expectedMessageId: raid.staffMessageId,
        changedAt,
      });
      const retained = await this.repository.getRaid(raid.id);
      return retained?.staffMessageId;
    }
    const created = await createDiscordMessage(
      environment,
      communityConfig.discord.staffChannelId,
      message,
    );
    let stored: boolean;
    try {
      stored = await this.repository.compareAndSetRaidStaffMessage({
        groupId: raid.id,
        ...(raid.staffMessageId === undefined ? {} : { expectedMessageId: raid.staffMessageId }),
        messageId: created.id,
        changedAt,
      });
    } catch (error) {
      await deleteDuplicateRaidMessage({
        environment,
        channelId: communityConfig.discord.staffChannelId,
        messageId: created.id,
      });
      throw error;
    }
    if (stored) return created.id;
    await deleteDuplicateRaidMessage({
      environment,
      channelId: communityConfig.discord.staffChannelId,
      messageId: created.id,
    });
    const retained = await this.repository.getRaid(raid.id);
    if (retained?.staffMessageId !== undefined) return retained.staffMessageId;
    throw new RepositoryInvariantError("That raid is no longer available to review.");
  }

  private async deleteRaidMessage(messageId: string | undefined): Promise<boolean> {
    if (messageId === undefined) return true;
    try {
      await deleteDiscordMessage(
        this.dependencies.environment,
        this.dependencies.communityConfig.discord.staffChannelId,
        messageId,
      );
      return true;
    } catch (error) {
      return error instanceof DiscordApiError && error.status === 404;
    }
  }

  private async refreshPulledRaidMessage(raid: StaffBoardRaid): Promise<void> {
    const { communityConfig, environment } = this.dependencies;
    if (raid.staffMessageId === undefined) return;
    const message = await raidDetailMessage({
      raid,
      repository: this.repository,
      communityConfig,
    });
    try {
      await updateDiscordMessage(
        environment,
        communityConfig.discord.staffChannelId,
        raid.staffMessageId,
        message,
      );
    } catch (error) {
      if (!(error instanceof DiscordApiError) || error.status !== 404) throw error;
      await reconcileRaidMessage({
        ...this.dependencies,
        raid,
        repository: this.repository,
      });
    }
  }

  async open(interaction: StaffInteraction): Promise<Response> {
    const { communityConfig } = this.dependencies;
    if (!hasAccess(interaction, communityConfig)) {
      return ephemeral("Use `/board` in the staff channel as the streamer or a volunteer sherpa.");
    }
    await this.materialize();
    const messageId = await synchronizeCanonicalBoard({
      environment: this.dependencies.environment,
      communityConfig,
      changedAt: this.dependencies.changedAt,
      createIfMissing: true,
    });
    if (messageId === undefined) throw new Error("The canonical board was not created.");
    this.reconcileBoardLater();
    return ephemeral(
      `[Open the sherpa board](${discordMessageUrl(
        communityConfig.discord.guildId,
        communityConfig.discord.staffChannelId,
        messageId,
      )})`,
    );
  }

  private async reviewRaid(interaction: DiscordMessageComponentInteraction): Promise<Response> {
    const { communityConfig, changedAt } = this.dependencies;
    const raidId = Number(selectedValue(interaction));
    if (!Number.isSafeInteger(raidId) || raidId < 1) {
      throw new RepositoryInvariantError("Choose a current raid to review.");
    }
    const reviewed = await this.repository.reviewRaid({ groupId: raidId, changedAt });
    const messageId = await this.ensureReviewMessage(reviewed, interaction.discordUserId);
    this.refreshBoardLater();
    if (messageId === undefined) {
      return ephemeral(
        "That review message was deleted. The raid is back on the board. Review it again to open new details.",
      );
    }
    return ephemeral(
      `[Open raid details](${discordMessageUrl(
        communityConfig.discord.guildId,
        communityConfig.discord.staffChannelId,
        messageId,
      )})`,
    );
  }

  private async cancelReview(
    interaction: DiscordMessageComponentInteraction,
    raid: StaffBoardRaid,
  ): Promise<Response> {
    const { changedAt } = this.dependencies;
    if (interaction.messageId === undefined) {
      throw new RepositoryInvariantError("That review control is out of date.");
    }
    const dismissed = await this.repository.dismissRaidReview({
      groupId: raid.id,
      expectedMessageId: interaction.messageId,
      changedAt,
    });
    if (!dismissed) {
      throw new RepositoryInvariantError("That review is no longer available to cancel.");
    }
    const deleted = await this.deleteRaidMessage(interaction.messageId);
    if (!deleted) {
      await this.repository.compareAndSetRaidStaffMessage({
        groupId: raid.id,
        messageId: interaction.messageId,
        changedAt,
      });
      throw new RepositoryInvariantError(
        "Discord could not close that review. Try Cancel review again.",
      );
    }
    this.refreshBoardLater();
    return ephemeral("Review closed. The raid is still on the board.");
  }

  private async showPullCandidates(raid: StaffBoardRaid): Promise<Response> {
    const candidates = await this.repository.getPullRequesterCandidates(raid.id);
    if (candidates === undefined) {
      return ephemeral("No later requester is available for this raid.");
    }
    return ephemeralMessage(renderPullRequesterSelector(raid, candidates.source));
  }

  private requesterId(interaction: DiscordMessageComponentInteraction): number {
    const requestId = Number(selectedValue(interaction));
    if (!Number.isSafeInteger(requestId) || requestId < 1) {
      throw new RepositoryInvariantError("Choose a current requester.");
    }
    return requestId;
  }

  private async pullRequester(
    interaction: DiscordMessageComponentInteraction,
    action: Extract<RaidMessageAction, { action: "pull" }>,
    raid: StaffBoardRaid,
  ): Promise<Response> {
    const pulled = await this.repository.pullRequester({
      destinationGroupId: raid.id,
      sourceGroupId: action.sourceRaidId,
      requestId: this.requesterId(interaction),
      actionKey: interaction.interactionId,
      changedAt: this.dependencies.changedAt,
    });
    await this.refreshPulledRaidMessage(pulled.destination);
    this.refreshBoardLater();
    if (pulled.sourceDisposition === "closed") {
      return ephemeral("Requester pulled up. The empty source raid was closed.");
    }
    if (pulled.sourceDisposition === "pushed") {
      return ephemeral(
        "Requester pulled up. The remaining source requesters moved to the next compatible raid.",
      );
    }
    return ephemeral("Requester pulled up. The remaining source raid stayed in place.");
  }

  private async callRaid(
    interaction: DiscordMessageComponentInteraction,
    raid: StaffBoardRaid,
    isStreamer: boolean,
  ): Promise<Response> {
    const { communityConfig, changedAt } = this.dependencies;
    if (raid.state !== "planned" || raid.staffMessageId === undefined) {
      throw new RepositoryInvariantError("That raid is no longer available to start.");
    }
    if (
      raid.leaderDiscordUserId !== undefined &&
      !isStreamer &&
      raid.leaderDiscordUserId !== interaction.discordUserId
    ) {
      throw new RepositoryInvariantError(
        "Only the reserved leader or streamer can start this postponed raid.",
      );
    }
    let started = await this.repository.startRaid({
      groupId: raid.id,
      leaderDiscordUserId: interaction.discordUserId,
      leaderType: isStreamer ? "streamer" : "volunteer",
      requestTwitchCall: isStreamer,
      canOverrideReservedLeader: isStreamer,
      changedAt,
    });
    await sendRaidCalls(started, this.dependencies, this.repository);
    started = (await this.repository.getRaid(raid.id)) ?? started;
    this.refreshBoardLater();
    return update(renderRaidMessage(started, communityConfig.policies.attemptLimit));
  }

  private assertRaidControlAccess(
    interaction: DiscordMessageComponentInteraction,
    raid: StaffBoardRaid,
    isStreamer: boolean,
  ): boolean {
    const isReviewedPlanned =
      raid.state === "planned" && !raid.automaticFill && raid.staffMessageId !== undefined;
    if (
      !isReviewedPlanned &&
      !isStreamer &&
      interaction.discordUserId !== raid.leaderDiscordUserId
    ) {
      throw new RepositoryInvariantError("Only this raid's leader or the streamer can use it.");
    }
    return isReviewedPlanned;
  }

  private async recordRaidResult(
    interaction: DiscordMessageComponentInteraction,
    raid: StaffBoardRaid,
  ): Promise<Response> {
    const { communityConfig, changedAt } = this.dependencies;
    const result = selectedValue(interaction);
    if (result !== "helped" && result !== "unsuccessful" && result !== "postpone_raid") {
      throw new RepositoryInvariantError("Choose an available raid result.");
    }
    if (result === "postpone_raid") {
      await this.repository.postponeRaid({
        groupId: raid.id,
        actionKey: interaction.interactionId,
        changedAt,
      });
      const deleted = await this.deleteRaidMessage(raid.staffMessageId);
      this.refreshBoardLater();
      return ephemeral(
        deleted
          ? "Raid postponed to the end of the Priority queue."
          : "Raid postponed to the end of the Priority queue, but its old details message could not be deleted.",
      );
    }
    const updatedRaid = await this.repository.recordRaidResult({
      groupId: raid.id,
      outcome: result,
      attemptLimit: communityConfig.policies.attemptLimit,
      actionKey: interaction.interactionId,
      changedAt,
    });
    this.refreshBoardLater();
    if (result !== "helped") {
      return update(renderRaidMessage(updatedRaid, communityConfig.policies.attemptLimit));
    }
    const deleted = await this.deleteRaidMessage(raid.staffMessageId);
    return ephemeral(
      deleted
        ? "Raid recorded as Helped."
        : "Raid recorded as Helped, but its old details message could not be deleted.",
    );
  }

  private async removeRequester(
    interaction: DiscordMessageComponentInteraction,
    raid: StaffBoardRaid,
  ): Promise<Response> {
    const { communityConfig, changedAt } = this.dependencies;
    const updated = await this.repository.removeRequester({
      groupId: raid.id,
      requestId: this.requesterId(interaction),
      actionKey: interaction.interactionId,
      changedAt,
    });
    this.refreshBoardLater();
    if (updated.state !== "canceled") {
      return update(
        await raidDetailMessage({
          raid: updated,
          repository: this.repository,
          communityConfig,
        }),
      );
    }
    const deleted = await this.deleteRaidMessage(raid.staffMessageId);
    return ephemeral(
      deleted
        ? "Requester removed. The empty raid was closed."
        : "Requester removed and the empty raid was closed, but its old details message could not be deleted.",
    );
  }

  private async postponeRequester(
    interaction: DiscordMessageComponentInteraction,
    raid: StaffBoardRaid,
  ): Promise<Response> {
    const { communityConfig, changedAt } = this.dependencies;
    const postponed = await this.repository.postponeRequester({
      groupId: raid.id,
      requestId: this.requesterId(interaction),
      actionKey: interaction.interactionId,
      changedAt,
    });
    this.refreshBoardLater();
    if (postponed.source.state !== "canceled") {
      return update(
        await raidDetailMessage({
          raid: postponed.source,
          repository: this.repository,
          communityConfig,
        }),
      );
    }
    const deleted = await this.deleteRaidMessage(raid.staffMessageId);
    return ephemeral(
      deleted
        ? "Requester postponed to the next raid. The empty raid was closed."
        : "Requester postponed and the empty raid was closed, but its old details message could not be deleted.",
    );
  }

  private async handleRaidAction(
    interaction: DiscordMessageComponentInteraction,
    action: RaidMessageAction,
  ): Promise<Response> {
    const { communityConfig } = this.dependencies;
    const raid = await this.repository.getRaid(action.raidId);
    if (raid === undefined) throw new RepositoryInvariantError("That raid no longer exists.");
    const isStreamer = interaction.discordUserId === communityConfig.discord.streamerUserId;
    if (action.action === "cancel") return this.cancelReview(interaction, raid);
    if (action.action === "pull_candidates") return this.showPullCandidates(raid);
    if (action.action === "pull") return this.pullRequester(interaction, action, raid);
    if (action.action === "call") return this.callRaid(interaction, raid, isStreamer);

    const isReviewedPlanned = this.assertRaidControlAccess(interaction, raid, isStreamer);
    if (isReviewedPlanned && action.action === "result") {
      throw new RepositoryInvariantError("Call and start this raid before recording a result.");
    }
    if (action.action === "result") return this.recordRaidResult(interaction, raid);
    if (action.action === "remove") return this.removeRequester(interaction, raid);
    return this.postponeRequester(interaction, raid);
  }

  async handle(interaction: DiscordMessageComponentInteraction): Promise<Response> {
    const { communityConfig, changedAt } = this.dependencies;
    if (!hasAccess(interaction, communityConfig)) {
      return ephemeral("Only the streamer or a volunteer sherpa can use these controls.");
    }
    const boardAction = parseStaffBoardAction(interaction.customId);
    const raidAction = parseRaidMessageAction(interaction.customId);
    if (boardAction === undefined && raidAction === undefined) {
      return new Response("Unsupported component", { status: 400 });
    }
    await this.materialize();
    if (boardAction?.action === "retired_start") {
      return ephemeral("This board is out of date. Use Refresh, then review the raid again.");
    }
    if (boardAction?.action === "refresh") {
      this.reconcileBoardLater();
      return update(
        boardMessage(await this.repository.getBoardSnapshot(changedAt), communityConfig),
      );
    }
    if (
      !(await this.repository.claimDiscordMutation(
        interaction.interactionId,
        boardAction === undefined ? `raid:${raidAction?.action}` : "raid:review",
        changedAt,
      ))
    ) {
      return ephemeral("That action was already received.");
    }
    try {
      if (boardAction?.action === "review") {
        return await this.reviewRaid(interaction);
      }
      if (raidAction === undefined) {
        return new Response("Unsupported component", { status: 400 });
      }
      return await this.handleRaidAction(interaction, raidAction);
    } catch (error) {
      if (error instanceof RepositoryInvariantError) return ephemeral(error.message);
      throw error;
    }
  }
}

export function openDiscordStaffBoard(
  interaction: DiscordApplicationCommandInteraction,
  dependencies: StaffBoardHandlerDependencies,
): Promise<Response> {
  return new StaffBoardHandler(dependencies).open(interaction);
}

export function handleDiscordStaffBoardComponent(
  interaction: DiscordMessageComponentInteraction,
  dependencies: StaffBoardHandlerDependencies,
): Promise<Response> {
  return new StaffBoardHandler(dependencies).handle(interaction);
}
