import type { CommunityConfig } from "../../config/community";
import { formatModeMap } from "../../domain/game-mode";
import { resolveTarkovMap } from "../../domain/maps/catalog";
import { appendRaidBringSuffix } from "../../domain/raid-call";
import { RepositoryInvariantError } from "../../domain/sherpa-repository";
import { isStaffBoardMember, type StaffBoardRaid } from "../../domain/staff-board";
import { D1MvpRepository } from "../cloudflare/d1-mvp-repository";
import { logDiagnostic } from "../cloudflare/diagnostics";
import type { CloudflareEnvironment } from "../cloudflare/environment";
import { scheduleBackground, type TrackedExecutionContext } from "../cloudflare/telemetry";
import { sendTwitchChatMessage } from "../twitch/twitch-api";
import {
  DISCORD_EPHEMERAL_MESSAGE_FLAG,
  DISCORD_INTERACTION_RESPONSE_CHANNEL_MESSAGE,
  DISCORD_INTERACTION_RESPONSE_DEFERRED_CHANNEL_MESSAGE,
  DISCORD_INTERACTION_RESPONSE_UPDATE_MESSAGE,
  type DiscordApplicationCommandInteraction,
  type DiscordMessageComponentInteraction,
} from "./interactions";
import {
  createDiscordMessage,
  discordMessageUrl,
  updateDiscordInteractionResponse,
} from "./messages";
import { executeDiscordMutation } from "./mutation-lifecycle";
import {
  deleteRaidDetailMessage,
  raidDetailMessage,
  reconcileVisibleRaidMessages,
  synchronizeCanonicalBoard,
  synchronizeRaidDetails,
} from "./raid-messages";
import {
  type DiscordBotMessage,
  parseRaidMessageAction,
  parseStaffBoardAction,
  type RaidMessageAction,
  renderPullRequesterSelector,
  renderRaidMessage,
} from "./staff-board";

type StaffInteraction = Pick<
  DiscordApplicationCommandInteraction,
  "discordUserId" | "discordRoleIds" | "channelId" | "applicationId" | "interactionToken"
>;

export interface StaffBoardHandlerDependencies {
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  changedAt: Date;
  context?: ExecutionContext | TrackedExecutionContext;
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

function deferredEphemeral(): Response {
  return Response.json({
    type: DISCORD_INTERACTION_RESPONSE_DEFERRED_CHANNEL_MESSAGE,
    data: { flags: DISCORD_EPHEMERAL_MESSAGE_FLAG },
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
  const startedAt = raid.startedAt;
  if (startedAt === undefined) {
    throw new RepositoryInvariantError("The active raid start time is missing.");
  }
  const persistStatus = async (
    platform: "discord" | "twitch",
    outcome: "sent" | "failed",
  ): Promise<void> => {
    try {
      await repository.updateCallStatus({
        groupId: raid.id,
        startedAt,
        platform,
        status: outcome,
        changedAt,
      });
    } catch {
      logDiagnostic("warn", "raid_call_status_write_failed", { platform, outcome });
    }
  };
  const sendDiscord = async (): Promise<void> => {
    const outcome = await createDiscordMessage(
      environment,
      communityConfig.discord.requestChannelId,
      {
        content: appendRaidBringSuffix(`Starting ${raidName}: ${discordMentions}`, resolvedMap),
        allowed_mentions: { parse: [], users: uniqueUsers },
      },
    )
      .then(() => "sent" as const)
      .catch(() => "failed" as const);
    await persistStatus("discord", outcome);
  };
  const sendTwitch = async (): Promise<void> => {
    if (raid.twitchCallStatus !== "pending") return;
    const outcome = await sendTwitchChatMessage(
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
    )
      .then(() => "sent" as const)
      .catch(() => "failed" as const);
    await persistStatus("twitch", outcome);
  };
  await Promise.all([sendDiscord(), sendTwitch()]);
}

class StaffBoardHandler {
  private readonly repository: D1MvpRepository;

  constructor(private readonly dependencies: StaffBoardHandlerDependencies) {
    this.repository = new D1MvpRepository(dependencies.environment.DB);
  }

  private deferRestWork(
    interaction: StaffInteraction,
    name: string,
    work: (handler: StaffBoardHandler) => Promise<string>,
  ): Response {
    scheduleBackground(
      this.dependencies.context,
      name,
      this.dependencies.environment,
      async (environment) => {
        const handler = new StaffBoardHandler({ ...this.dependencies, environment });
        let content: string;
        try {
          content = await work(handler);
        } catch (error) {
          logDiagnostic("warn", "discord_deferred_staff_action_failed", { task: name });
          content =
            error instanceof RepositoryInvariantError
              ? error.message
              : "Discord could not finish that action. Try again.";
        }
        await updateDiscordInteractionResponse(
          environment,
          interaction.applicationId,
          interaction.interactionToken,
          { content, allowed_mentions: { parse: [] } },
        );
      },
    );
    return deferredEphemeral();
  }

  private refreshBoardLater(): void {
    scheduleBackground(
      this.dependencies.context,
      "discord.board_drain",
      this.dependencies.environment,
      async (environment) => {
        await synchronizeCanonicalBoard({
          environment,
          communityConfig: this.dependencies.communityConfig,
          changedAt: this.dependencies.changedAt,
          createIfMissing: false,
          ...(this.dependencies.context === undefined
            ? {}
            : { context: this.dependencies.context }),
        });
      },
    );
  }

  private reconcileBoardLater(
    snapshot: Awaited<ReturnType<D1MvpRepository["getBoardSnapshot"]>>,
  ): void {
    scheduleBackground(
      this.dependencies.context,
      "discord.board_reconciliation",
      this.dependencies.environment,
      async (environment) => {
        const identityChanged = await reconcileVisibleRaidMessages({
          ...this.dependencies,
          environment,
          snapshot,
        });
        if (identityChanged) {
          new StaffBoardHandler({ ...this.dependencies, environment }).refreshBoardLater();
        }
      },
    );
  }

  private refreshAndReconcileBoardLater(): void {
    scheduleBackground(
      this.dependencies.context,
      "discord.board_drain",
      this.dependencies.environment,
      async (environment) => {
        const handler = new StaffBoardHandler({ ...this.dependencies, environment });
        let renderedSnapshot: Awaited<ReturnType<D1MvpRepository["getBoardSnapshot"]>> | undefined;
        await synchronizeCanonicalBoard({
          environment,
          communityConfig: this.dependencies.communityConfig,
          changedAt: this.dependencies.changedAt,
          createIfMissing: false,
          captureSnapshot(snapshot) {
            renderedSnapshot = snapshot;
          },
          ...(this.dependencies.context === undefined
            ? {}
            : { context: this.dependencies.context }),
        });
        if (renderedSnapshot !== undefined) {
          handler.reconcileBoardLater(renderedSnapshot);
        }
      },
    );
  }

  open(interaction: StaffInteraction): Response {
    const { communityConfig } = this.dependencies;
    if (!hasAccess(interaction, communityConfig)) {
      return ephemeral("Use `/board` in the staff channel as the streamer or a volunteer sherpa.");
    }
    return this.deferRestWork(interaction, "discord.board_open", async (handler) => {
      let renderedSnapshot: Awaited<ReturnType<D1MvpRepository["getBoardSnapshot"]>> | undefined;
      const messageId = await synchronizeCanonicalBoard({
        environment: handler.dependencies.environment,
        communityConfig,
        changedAt: handler.dependencies.changedAt,
        createIfMissing: true,
        captureSnapshot(snapshot) {
          renderedSnapshot = snapshot;
        },
        ...(handler.dependencies.context === undefined
          ? {}
          : { context: handler.dependencies.context }),
      });
      if (messageId === undefined) throw new Error("The canonical board was not created.");
      const currentSnapshot =
        renderedSnapshot ??
        (await handler.repository.getBoardSnapshot(handler.dependencies.changedAt));
      handler.reconcileBoardLater(currentSnapshot);
      return `[Open the sherpa board](${discordMessageUrl(
        communityConfig.discord.guildId,
        communityConfig.discord.staffChannelId,
        messageId,
      )})`;
    });
  }

  private async reviewRaid(interaction: DiscordMessageComponentInteraction): Promise<Response> {
    const { communityConfig, changedAt } = this.dependencies;
    const raidId = Number(selectedValue(interaction));
    if (!Number.isSafeInteger(raidId) || raidId < 1) {
      throw new RepositoryInvariantError("Choose a current raid to review.");
    }
    const reviewed = await this.repository.reviewRaid({ groupId: raidId, changedAt });
    return this.deferRestWork(interaction, "discord.raid_review", async (handler) => {
      const messageId = await synchronizeRaidDetails({
        ...handler.dependencies,
        repository: handler.repository,
        raid: reviewed,
        reason: "review",
        notificationUserId: interaction.discordUserId,
      });
      handler.refreshBoardLater();
      if (messageId == null) {
        return "That review message was deleted. The raid is back on the board. Review it again to open new details.";
      }
      return `[Open raid details](${discordMessageUrl(
        communityConfig.discord.guildId,
        communityConfig.discord.staffChannelId,
        messageId,
      )})`;
    });
  }

  private async cancelReview(
    interaction: DiscordMessageComponentInteraction,
    raid: StaffBoardRaid,
  ): Promise<Response> {
    const { changedAt } = this.dependencies;
    const messageId = interaction.messageId;
    if (messageId === undefined) {
      throw new RepositoryInvariantError("That review control is out of date.");
    }
    const dismissed = await this.repository.dismissRaidReview({
      groupId: raid.id,
      expectedMessageId: messageId,
      changedAt,
    });
    if (!dismissed) {
      throw new RepositoryInvariantError("That review is no longer available to cancel.");
    }
    return this.deferRestWork(interaction, "discord.review_cancel", async (handler) => {
      const deleted = await deleteRaidDetailMessage(handler.dependencies, messageId);
      if (!deleted) {
        await handler.repository.compareAndSetRaidStaffMessage({
          groupId: raid.id,
          messageId,
          changedAt,
        });
        throw new RepositoryInvariantError(
          "Discord could not close that review. Try Cancel review again.",
        );
      }
      handler.refreshBoardLater();
      return "Review closed. The raid is still on the board.";
    });
  }

  private async showPullCandidates(
    raid: StaffBoardRaid,
    sourceGroupId?: number,
  ): Promise<Response> {
    const candidates = await this.repository.getPullRequesterCandidates(
      raid.id,
      sourceGroupId === undefined ? {} : { sourceGroupId },
    );
    if (candidates === undefined) {
      return ephemeral(
        "No compatible requester is available for this raid. Refresh the board to update the list.",
      );
    }
    if (sourceGroupId !== undefined)
      return update(
        renderRaidMessage(
          raid,
          this.dependencies.communityConfig.policies.attemptLimit,
          undefined,
          candidates.source,
        ),
      );
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
    action: Extract<RaidMessageAction, { sourceRaidId: number }>,
    raid: StaffBoardRaid,
  ): Promise<Response> {
    const pulled = await this.repository.pullRequester({
      destinationGroupId: raid.id,
      authorizedDestination: raid,
      sourceGroupId: action.sourceRaidId,
      requestId: this.requesterId(interaction),
      actionKey: interaction.interactionId,
      changedAt: this.dependencies.changedAt,
    });
    scheduleBackground(
      this.dependencies.context,
      "discord.pulled_raid_detail",
      this.dependencies.environment,
      async (environment) => {
        await synchronizeRaidDetails({
          ...this.dependencies,
          environment,
          repository: new D1MvpRepository(environment.DB),
          raid: pulled.destination,
          reason: "pull",
        });
      },
    );
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
    const started = await this.repository.startRaid({
      groupId: raid.id,
      leaderDiscordUserId: interaction.discordUserId,
      leaderType: isStreamer ? "streamer" : "volunteer",
      requestTwitchCall: isStreamer,
      canOverrideReservedLeader: isStreamer,
      changedAt,
    });
    scheduleBackground(
      this.dependencies.context,
      "discord.raid_calls",
      this.dependencies.environment,
      async (environment) => {
        await sendRaidCalls(
          started,
          { ...this.dependencies, environment },
          new D1MvpRepository(environment.DB),
        );
      },
    );
    this.refreshBoardLater();
    return update(
      await raidDetailMessage({ raid: started, repository: this.repository, communityConfig }),
    );
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
      this.refreshBoardLater();
      return this.deferRestWork(interaction, "discord.postponed_raid_detail", async (handler) => {
        const deleted = await deleteRaidDetailMessage(handler.dependencies, raid.staffMessageId);
        return deleted
          ? "Raid postponed to the end of the Priority queue."
          : "Raid postponed to the end of the Priority queue, but its old details message could not be deleted.";
      });
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
      return update(
        await raidDetailMessage({
          raid: updatedRaid,
          repository: this.repository,
          communityConfig,
        }),
      );
    }
    return this.deferRestWork(interaction, "discord.helped_raid_detail", async (handler) => {
      const deleted = await deleteRaidDetailMessage(handler.dependencies, raid.staffMessageId);
      return deleted
        ? "Raid recorded as Helped."
        : "Raid recorded as Helped, but its old details message could not be deleted.";
    });
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
    return this.deferRestWork(interaction, "discord.removed_raid_detail", async (handler) => {
      const deleted = await deleteRaidDetailMessage(handler.dependencies, raid.staffMessageId);
      return deleted
        ? "Requester removed. The empty raid was closed."
        : "Requester removed and the empty raid was closed, but its old details message could not be deleted.";
    });
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
    return this.deferRestWork(
      interaction,
      "discord.postponed_requester_detail",
      async (handler) => {
        const deleted = await deleteRaidDetailMessage(handler.dependencies, raid.staffMessageId);
        return deleted
          ? "Requester postponed to the next raid. The empty raid was closed."
          : "Requester postponed and the empty raid was closed, but its old details message could not be deleted.";
      },
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
    if (
      action.action === "pull_candidates" ||
      action.action === "pull_page" ||
      action.action === "pull"
    ) {
      this.assertRaidControlAccess(interaction, raid, isStreamer);
    }
    if (action.action === "pull_candidates") return this.showPullCandidates(raid);
    if (action.action === "pull_page") return this.showPullCandidates(raid, action.sourceRaidId);
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
    if (boardAction?.action === "retired_start") {
      return ephemeral("This board is out of date. Use Refresh, then review the raid again.");
    }
    if (boardAction?.action === "refresh") {
      await this.repository.markBoardDirty(changedAt);
      this.refreshAndReconcileBoardLater();
      return ephemeral("Refreshing the sherpa board.");
    }
    const mutation = await executeDiscordMutation(
      {
        ...this.dependencies,
        repository: this.repository,
        deliveryId: interaction.interactionId,
        eventType: boardAction === undefined ? `raid:${raidAction?.action}` : "raid:review",
      },
      async () => {
        try {
          if (boardAction?.action === "review") return await this.reviewRaid(interaction);
          if (raidAction === undefined)
            return new Response("Unsupported component", { status: 400 });
          return await this.handleRaidAction(interaction, raidAction);
        } catch (error) {
          // A domain rejection is a handled action, not a retryable infrastructure failure.
          if (error instanceof RepositoryInvariantError) return ephemeral(error.message);
          throw error;
        }
      },
    );
    return mutation.outcome === "duplicate"
      ? ephemeral("That action was already received.")
      : mutation.value;
  }
}

export function openDiscordStaffBoard(
  interaction: DiscordApplicationCommandInteraction,
  dependencies: StaffBoardHandlerDependencies,
): Promise<Response> {
  return Promise.resolve(new StaffBoardHandler(dependencies).open(interaction));
}

export function handleDiscordStaffBoardComponent(
  interaction: DiscordMessageComponentInteraction,
  dependencies: StaffBoardHandlerDependencies,
): Promise<Response> {
  return new StaffBoardHandler(dependencies).handle(interaction);
}
