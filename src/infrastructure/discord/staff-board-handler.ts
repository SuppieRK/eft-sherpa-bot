import type { CommunityConfig } from "../../config/community";
import { resolveTarkovMap } from "../../domain/maps/catalog";
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
  getDiscordMessage,
  updateDiscordMessage,
} from "./messages";
import {
  parseRaidMessageAction,
  parseStaffBoardAction,
  renderRaidMessage,
  renderStaffBoard,
  type DiscordBotMessage,
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

async function reconcileActiveRaidMessage(input: {
  raid: StaffBoardRaid;
  repository: D1MvpRepository;
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  changedAt: Date;
}): Promise<void> {
  if (input.raid.state !== "active") return;
  const channelId = input.communityConfig.discord.staffChannelId;
  if (input.raid.staffMessageId !== undefined) {
    try {
      await getDiscordMessage(input.environment, channelId, input.raid.staffMessageId);
      return;
    } catch (error) {
      if (!(error instanceof DiscordApiError) || error.status !== 404) return;
    }
    const cleared = await input.repository.compareAndSetRaidStaffMessage({
      groupId: input.raid.id,
      expectedMessageId: input.raid.staffMessageId,
      changedAt: input.changedAt,
    });
    if (!cleared) return;
  }

  const current = await input.repository.getRaid(input.raid.id);
  if (current === undefined || current.state !== "active" || current.staffMessageId !== undefined) {
    return;
  }
  const created = await createDiscordMessage(
    input.environment,
    channelId,
    renderRaidMessage(current, input.communityConfig.policies.attemptLimit),
  );
  try {
    const stored = await input.repository.compareAndSetRaidStaffMessage({
      groupId: current.id,
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

async function reconcileVisibleActiveRaidMessages(input: {
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  changedAt: Date;
}): Promise<void> {
  const repository = new D1MvpRepository(input.environment.DB);
  const snapshot = await repository.getBoardSnapshot(input.changedAt);
  const visibleActiveRaids = [...snapshot.priorityRaids, ...snapshot.ordinaryRaids].filter(
    (raid) => raid.state === "active",
  );
  await Promise.allSettled(
    visibleActiveRaids.map((raid) =>
      reconcileActiveRaidMessage({
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
  const map = resolveTarkovMap(raid.mapId)?.name ?? raid.mapId;
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
  try {
    await createDiscordMessage(environment, communityConfig.discord.requestChannelId, {
      content: `Starting ${map}: ${[...uniqueUsers.map((id) => `<@${id}>`), ...unlinkedNames].join(" ")}`,
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
        message: `Starting ${map}: ${raid.members.map((member) => `@${member.twitchLogin}`).join(" ")}. Check Discord for details.`,
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
    const work = reconcileVisibleActiveRaidMessages(this.dependencies).catch(() => undefined);
    this.dependencies.context?.waitUntil(work);
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

  async handle(interaction: DiscordMessageComponentInteraction): Promise<Response> {
    const { communityConfig, changedAt, environment } = this.dependencies;
    if (!hasAccess(interaction, communityConfig)) {
      return ephemeral("Only the streamer or a volunteer sherpa can use these controls.");
    }
    const boardAction = parseStaffBoardAction(interaction.customId);
    const raidAction = parseRaidMessageAction(interaction.customId);
    if (boardAction === undefined && raidAction === undefined) {
      return new Response("Unsupported component", { status: 400 });
    }
    await this.materialize();
    if (boardAction?.action === "refresh") {
      this.reconcileBoardLater();
      return update(
        boardMessage(await this.repository.getBoardSnapshot(changedAt), communityConfig),
      );
    }
    if (
      !(await this.repository.claimDiscordMutation(
        interaction.interactionId,
        boardAction === undefined ? `raid:${raidAction?.action}` : "raid:start",
        changedAt,
      ))
    ) {
      return ephemeral("That action was already received.");
    }
    try {
      if (boardAction?.action === "start") {
        const raidId = Number(selectedValue(interaction));
        const planned = await this.repository.getRaid(raidId);
        if (planned === undefined || planned.state !== "planned") {
          throw new RepositoryInvariantError("That raid is no longer available to start.");
        }
        const isStreamer = interaction.discordUserId === communityConfig.discord.streamerUserId;
        if (
          !planned.automaticFill &&
          !isStreamer &&
          planned.leaderDiscordUserId !== interaction.discordUserId
        ) {
          throw new RepositoryInvariantError(
            "Only the reserved leader or streamer can start this postponed raid.",
          );
        }
        let raid = await this.repository.startRaid({
          groupId: raidId,
          leaderDiscordUserId: interaction.discordUserId,
          leaderType: isStreamer ? "streamer" : "volunteer",
          requestTwitchCall: isStreamer,
          changedAt,
        });
        await sendRaidCalls(raid, this.dependencies, this.repository);
        raid = (await this.repository.getRaid(raidId)) ?? raid;
        const message = await createDiscordMessage(
          environment,
          communityConfig.discord.staffChannelId,
          renderRaidMessage(raid, communityConfig.policies.attemptLimit, true),
        );
        await this.repository.setRaidStaffMessage(raidId, message.id, changedAt);
        return update(
          boardMessage(await this.repository.getBoardSnapshot(changedAt), communityConfig),
        );
      }
      const raid = await this.repository.getRaid(raidAction?.raidId ?? 0);
      if (raid === undefined) throw new RepositoryInvariantError("That raid no longer exists.");
      if (
        interaction.discordUserId !== communityConfig.discord.streamerUserId &&
        interaction.discordUserId !== raid.leaderDiscordUserId
      ) {
        throw new RepositoryInvariantError("Only this raid's leader or the streamer can use it.");
      }
      if (raidAction?.action === "result") {
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
        if (result === "helped") {
          const deleted = await this.deleteRaidMessage(raid.staffMessageId);
          const confirmation = "Raid recorded as Helped.";
          return ephemeral(
            deleted
              ? confirmation
              : `${confirmation.slice(0, -1)}, but its old details message could not be deleted.`,
          );
        }
        return update(renderRaidMessage(updatedRaid, communityConfig.policies.attemptLimit));
      }
      const requestId = Number(selectedValue(interaction));
      if (!Number.isSafeInteger(requestId) || requestId < 1) {
        throw new RepositoryInvariantError("Choose a current requester.");
      }
      if (raidAction?.action === "remove") {
        const updated = await this.repository.removeRequester({
          groupId: raid.id,
          requestId,
          actionKey: interaction.interactionId,
          changedAt,
        });
        this.refreshBoardLater();
        if (updated.state !== "canceled") {
          return update(renderRaidMessage(updated, communityConfig.policies.attemptLimit));
        }
        const deleted = await this.deleteRaidMessage(raid.staffMessageId);
        return ephemeral(
          deleted
            ? "Requester removed. The empty raid was closed."
            : "Requester removed and the empty raid was closed, but its old details message could not be deleted.",
        );
      }
      const postponed = await this.repository.postponeRequester({
        groupId: raid.id,
        requestId,
        actionKey: interaction.interactionId,
        changedAt,
      });
      this.refreshBoardLater();
      if (postponed.source.state === "canceled") {
        const deleted = await this.deleteRaidMessage(raid.staffMessageId);
        return ephemeral(
          deleted
            ? "Requester postponed to the next raid. The empty raid was closed."
            : "Requester postponed and the empty raid was closed, but its old details message could not be deleted.",
        );
      }
      return update(renderRaidMessage(postponed.source, communityConfig.policies.attemptLimit));
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
