import {
  communityConfigFromEnvironment,
  type CommunityConfig,
  validateCommunityConfig,
} from "./config/community";
import { QueueQueryService } from "./domain/queue-queries";
import { StaffStatisticsQueryService } from "./domain/staff-statistics";
import { formatModeMap, parseGameMode } from "./domain/game-mode";
import { resolveTarkovMap } from "./domain/maps/catalog";
import { parseTwitchRequestInput } from "./domain/twitch-request";
import { isStaffBoardMember } from "./domain/staff-board";
import { D1MvpRepository } from "./infrastructure/cloudflare/d1-mvp-repository";
import { logDiagnostic } from "./infrastructure/cloudflare/diagnostics";
import type { CloudflareEnvironment } from "./infrastructure/cloudflare/environment";
import { requireEnvironmentValue } from "./infrastructure/cloudflare/environment";
import { observeWorkerRequest } from "./infrastructure/cloudflare/telemetry";
import {
  DISCORD_EPHEMERAL_MESSAGE_FLAG,
  DISCORD_INTERACTION_RESPONSE_CHANNEL_MESSAGE,
  DISCORD_INTERACTION_RESPONSE_MODAL,
  DISCORD_INTERACTION_RESPONSE_PONG,
  DISCORD_INTERACTION_RESPONSE_UPDATE_MESSAGE,
  parseDiscordInteraction,
  readDiscordInteractionTimestamp,
  verifyDiscordInteractionRequest,
} from "./infrastructure/discord/interactions";
import {
  buildTwitchLinkedReply,
  DISCORD_LINK_TWITCH_COMMAND,
  parseEftNameOption,
  parseTwitchNameOption,
} from "./infrastructure/discord/link-twitch";
import {
  buildDiscordRequestCreatedReply,
  buildDiscordRequestModal,
  buildDiscordRequestValidationReply,
  DISCORD_REQUEST_COMMAND,
  DISCORD_REQUEST_MODAL_V2_PREFIX,
  requestModalGameMode,
  validateDiscordRequestModal,
} from "./infrastructure/discord/request-form";
import {
  handleDiscordStaffBoardComponent,
  openDiscordStaffBoard,
  synchronizeCanonicalBoard,
} from "./infrastructure/discord/staff-board-handler";
import {
  DISCORD_STAFF_BOARD_COMMAND,
  parseRaidMessageAction,
  parseStaffBoardAction,
} from "./infrastructure/discord/staff-board";
import {
  buildEftNameModal,
  DISCORD_STAFF_STATS_COMMAND,
  DISCORD_STAFF_USERS_COMMAND,
  parseUserDirectoryAction,
  renderStaffStatistics,
  renderUserDetail,
  renderUserDirectory,
  type StaffInsightsMessage,
  USER_DIRECTORY_EFT_FIELD,
} from "./infrastructure/discord/staff-insights";
import {
  parseEventSubChallenge,
  parseTwitchChatMessageEvent,
  verifyTwitchEventSubRequest,
} from "./infrastructure/twitch/eventsub";
import {
  parseTwitchPublicCommand,
  type TwitchPublicCommand,
} from "./infrastructure/twitch/public-commands";
import {
  sendTwitchChatMessage,
  TwitchApiError,
  type TwitchAuthorizationHealth,
  validateTwitchAuthorization,
} from "./infrastructure/twitch/twitch-api";
import { renderQueueFacts } from "./presentation/public-responses";

function discordEphemeralMessage(content: string, components?: unknown[]): Response {
  return Response.json({
    type: DISCORD_INTERACTION_RESPONSE_CHANNEL_MESSAGE,
    data: {
      content,
      flags: DISCORD_EPHEMERAL_MESSAGE_FLAG,
      allowed_mentions: { parse: [] },
      ...(components === undefined ? {} : { components }),
    },
  });
}

function discordEphemeralInsights(message: StaffInsightsMessage): Response {
  return Response.json({
    type: DISCORD_INTERACTION_RESPONSE_CHANNEL_MESSAGE,
    data: { ...message, flags: DISCORD_EPHEMERAL_MESSAGE_FLAG },
  });
}

function discordUpdateInsights(message: StaffInsightsMessage): Response {
  return Response.json({ type: DISCORD_INTERACTION_RESPONSE_UPDATE_MESSAGE, data: message });
}

function hasStaffAccess(
  interaction: {
    channelId: string;
    discordUserId: string;
    discordRoleIds: readonly string[];
  },
  communityConfig: CommunityConfig,
): boolean {
  return (
    interaction.channelId === communityConfig.discord.staffChannelId &&
    isStaffBoardMember({
      discordUserId: interaction.discordUserId,
      discordRoleIds: interaction.discordRoleIds,
      streamerDiscordUserId: communityConfig.discord.streamerUserId,
      volunteerRoleId: communityConfig.discord.volunteerRoleId,
    })
  );
}

function staffDenied(): Response {
  return discordEphemeralMessage(
    "Use this command in the staff channel as the streamer or a volunteer sherpa.",
  );
}

function materializeRaidBoard(
  repository: D1MvpRepository,
  communityConfig: CommunityConfig,
  changedAt: Date,
): Promise<number> {
  return repository.materializeWaitingRequests({
    recipientLimit: communityConfig.policies.recipientLimit,
    changedAt,
  });
}

function getTwitchAuthorizationRecovery(
  authorization: TwitchAuthorizationHealth,
): { action: "refresh_twitch_app_token"; operatorCommand: "npm run twitch:token" } | undefined {
  if (authorization.ok || !["revoked_or_expired", "wrong_client"].includes(authorization.reason)) {
    return undefined;
  }
  return { action: "refresh_twitch_app_token", operatorCommand: "npm run twitch:token" };
}

async function handleDiscordInteraction(
  request: Request,
  environment: CloudflareEnvironment,
  communityConfig: CommunityConfig,
  context: ExecutionContext,
): Promise<Response> {
  const rawBody = await request.text();
  if (
    !(await verifyDiscordInteractionRequest(
      request.headers,
      rawBody,
      communityConfig.discord.publicKey,
      new Date(),
    ))
  ) {
    return new Response("Invalid request signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const interaction = parseDiscordInteraction(payload);
  if (interaction === undefined) {
    return new Response("Unsupported interaction", { status: 400 });
  }
  if (interaction.type === "ping") {
    return Response.json({ type: DISCORD_INTERACTION_RESPONSE_PONG });
  }
  if (
    interaction.applicationId !== communityConfig.discord.applicationId ||
    interaction.guildId !== communityConfig.discord.guildId
  ) {
    return new Response("Unexpected Discord community", { status: 403 });
  }
  const changedAt = readDiscordInteractionTimestamp(request.headers);
  const repository = new D1MvpRepository(environment.DB);

  if (interaction.type === "application_command") {
    if (
      interaction.commandName === DISCORD_STAFF_STATS_COMMAND ||
      interaction.commandName === DISCORD_STAFF_USERS_COMMAND
    ) {
      if (!hasStaffAccess(interaction, communityConfig)) return staffDenied();
      if (interaction.commandName === DISCORD_STAFF_STATS_COMMAND) {
        const service = new StaffStatisticsQueryService(repository);
        return discordEphemeralInsights(renderStaffStatistics(await service.getAllTime()));
      }
      return discordEphemeralInsights(
        renderUserDirectory(await repository.getUserDirectoryPage({ direction: "first" })),
      );
    }
    if (interaction.commandName === DISCORD_STAFF_BOARD_COMMAND) {
      return openDiscordStaffBoard(interaction, {
        environment,
        communityConfig,
        changedAt,
        context,
      });
    }
    if (interaction.commandName === DISCORD_REQUEST_COMMAND) {
      const gameMode = parseGameMode(interaction.options.mode);
      if (gameMode === undefined) {
        return discordEphemeralMessage("Select PvP Seasonal, PvP, or PvE, then try again.");
      }
      const mapping = await repository.findUserMappingByDiscordId(interaction.discordUserId);
      return Response.json({
        type: DISCORD_INTERACTION_RESPONSE_MODAL,
        data: buildDiscordRequestModal(
          gameMode,
          mapping === undefined
            ? undefined
            : {
                twitchLogin: mapping.twitchLogin,
                ...(mapping.inGameName === undefined ? {} : { inGameName: mapping.inGameName }),
              },
        ),
      });
    }
    if (interaction.commandName === DISCORD_LINK_TWITCH_COMMAND) {
      const twitchLogin = parseTwitchNameOption(interaction.options.name);
      if (twitchLogin === undefined) {
        return discordEphemeralMessage(
          "Enter a Twitch name using letters, numbers, or underscore.",
        );
      }
      const rawEftName = interaction.options.eft;
      const inGameName = parseEftNameOption(rawEftName);
      if (rawEftName !== undefined && inGameName === undefined) {
        return discordEphemeralMessage(
          "Enter an Escape from Tarkov name between 1 and 64 characters.",
        );
      }
      const selectsDiscordMember = interaction.options.discord !== undefined;
      const targetDiscordUserId = interaction.options.discord ?? interaction.discordUserId;
      if (
        selectsDiscordMember &&
        !isStaffBoardMember({
          discordUserId: interaction.discordUserId,
          discordRoleIds: interaction.discordRoleIds,
          streamerDiscordUserId: communityConfig.discord.streamerUserId,
          volunteerRoleId: communityConfig.discord.volunteerRoleId,
        })
      ) {
        return discordEphemeralMessage(
          "Only the streamer or a volunteer sherpa can use the Discord member option.",
        );
      }
      if (
        !(await repository.claimDiscordMutation(
          interaction.interactionId,
          "identity:link-twitch",
          changedAt,
        ))
      ) {
        return discordEphemeralMessage("That link command was already received.");
      }
      const discordDisplayName =
        targetDiscordUserId === interaction.discordUserId
          ? interaction.discordDisplayName
          : interaction.resolvedUserDisplayNames[targetDiscordUserId];
      await repository.linkDiscordToTwitch({
        twitchLogin,
        discordUserId: targetDiscordUserId,
        ...(discordDisplayName === undefined ? {} : { discordDisplayName }),
        ...(inGameName === undefined ? {} : { inGameName }),
        linkedAt: changedAt,
      });
      return discordEphemeralMessage(
        buildTwitchLinkedReply(twitchLogin, targetDiscordUserId, inGameName),
      );
    }
    const queryService = new QueueQueryService(repository);
    if (interaction.commandName === "queue") {
      await materializeRaidBoard(repository, communityConfig, changedAt);
      return discordEphemeralMessage(
        renderQueueFacts(
          await queryService.queue({ platform: "discord", userId: interaction.discordUserId }),
          "discord",
        ),
      );
    }
    return new Response("Unsupported application command", { status: 400 });
  }

  if (interaction.type === "message_component") {
    const directoryAction = parseUserDirectoryAction(interaction.customId);
    if (directoryAction !== undefined) {
      if (!hasStaffAccess(interaction, communityConfig)) return staffDenied();
      if (
        directoryAction.action === "next" ||
        directoryAction.action === "previous" ||
        directoryAction.action === "at"
      ) {
        return discordUpdateInsights(
          renderUserDirectory(
            await repository.getUserDirectoryPage({
              direction: directoryAction.action,
              cursor: directoryAction.cursor,
            }),
          ),
        );
      }
      if (directoryAction.action === "detail") {
        const twitchLogin = interaction.values[0];
        const entry =
          twitchLogin === undefined
            ? undefined
            : await repository.findUserMappingByTwitchLogin(twitchLogin);
        return entry === undefined
          ? discordEphemeralMessage("Open `/users` again and select a current user.")
          : discordUpdateInsights(renderUserDetail(entry, directoryAction.pageFirst));
      }
      if (directoryAction.action === "add_eft") {
        return Response.json({
          type: DISCORD_INTERACTION_RESPONSE_MODAL,
          data: buildEftNameModal(directoryAction.twitchLogin, directoryAction.pageFirst),
        });
      }
      if (directoryAction.action !== "add_discord") {
        return discordEphemeralMessage("Open `/users` again and use a current control.");
      }
      const discordUserId = interaction.values[0];
      const hasResolvedMember =
        discordUserId !== undefined &&
        Object.hasOwn(interaction.resolvedRoleIdsByUser, discordUserId);
      if (!hasResolvedMember || discordUserId === undefined) {
        return discordEphemeralMessage("Select a current member of this Discord server.");
      }
      if (
        !(await repository.claimDiscordMutation(
          interaction.interactionId,
          "identity:complete-discord",
          changedAt,
        ))
      ) {
        return discordEphemeralMessage(
          "That user update was already received. Open `/users` again.",
        );
      }
      try {
        const outcome = await repository.completeMissingDiscord({
          twitchLogin: directoryAction.twitchLogin,
          discordUserId,
          ...(interaction.resolvedUserDisplayNames[discordUserId] === undefined
            ? {}
            : { discordDisplayName: interaction.resolvedUserDisplayNames[discordUserId] }),
          changedAt,
        });
        const entry = await repository.findUserMappingByTwitchLogin(directoryAction.twitchLogin);
        return outcome === "updated" && entry !== undefined
          ? discordUpdateInsights(renderUserDetail(entry, directoryAction.pageFirst))
          : discordEphemeralMessage("User details changed. Open `/users` again.");
      } catch {
        return discordEphemeralMessage(
          "That Discord member is already linked. Use `/link-twitch` to correct the association.",
        );
      }
    }
    if (
      parseStaffBoardAction(interaction.customId) !== undefined ||
      parseRaidMessageAction(interaction.customId) !== undefined
    ) {
      return handleDiscordStaffBoardComponent(interaction, {
        environment,
        communityConfig,
        changedAt,
        context,
      });
    }
    if (interaction.customId.startsWith("users:")) {
      return discordEphemeralMessage("Open `/users` again and use a current control.");
    }
    return new Response("Unsupported component", { status: 400 });
  }

  const userModalAction = parseUserDirectoryAction(interaction.customId);
  if (userModalAction?.action === "add_eft") {
    if (!hasStaffAccess(interaction, communityConfig)) return staffDenied();
    const inGameName = interaction.values[USER_DIRECTORY_EFT_FIELD]?.trim();
    if (inGameName === undefined || inGameName.length < 1 || inGameName.length > 64) {
      return discordEphemeralMessage("Enter an Escape from Tarkov name from 1 to 64 characters.");
    }
    if (
      !(await repository.claimDiscordMutation(
        interaction.interactionId,
        "identity:complete-eft",
        changedAt,
      ))
    ) {
      return discordEphemeralMessage("That user update was already received. Open `/users` again.");
    }
    const outcome = await repository.completeMissingInGameName({
      twitchLogin: userModalAction.twitchLogin,
      inGameName,
      changedAt,
    });
    const entry = await repository.findUserMappingByTwitchLogin(userModalAction.twitchLogin);
    return outcome === "updated" && entry !== undefined
      ? discordUpdateInsights(renderUserDetail(entry, userModalAction.pageFirst))
      : discordEphemeralMessage("User details changed. Open `/users` again.");
  }
  if (interaction.customId.startsWith("users:")) {
    return discordEphemeralMessage("Open `/users` again and use a current control.");
  }

  const gameMode = requestModalGameMode(interaction.customId);
  if (gameMode === undefined) {
    if (interaction.customId.startsWith(DISCORD_REQUEST_MODAL_V2_PREFIX)) {
      return discordEphemeralMessage("Select a valid game mode and open `/request` again.");
    }
    return new Response("Unsupported modal", { status: 400 });
  }
  const validation = validateDiscordRequestModal(interaction.values, gameMode);
  if (!validation.valid) {
    return discordEphemeralMessage(buildDiscordRequestValidationReply(validation));
  }
  await repository.claimDiscordMutation(interaction.interactionId, "request:create", changedAt);
  const created = await repository.createRequest({
    sourcePlatform: "discord",
    sourceDeliveryId: interaction.interactionId,
    discordUserId: interaction.discordUserId,
    ...(interaction.discordDisplayName === undefined
      ? {}
      : { discordDisplayName: interaction.discordDisplayName }),
    twitchLogin: validation.value.twitchLogin,
    gameMode: validation.value.gameMode,
    inGameName: validation.value.inGameName,
    mapId: validation.value.mapId,
    objective: validation.value.objective,
    ...(validation.value.notes === undefined ? {} : { notes: validation.value.notes }),
    observedAt: changedAt,
  });
  await materializeRaidBoard(repository, communityConfig, changedAt);
  context.waitUntil(
    synchronizeCanonicalBoard({
      environment,
      communityConfig,
      changedAt,
      createIfMissing: false,
    }).catch(() => undefined),
  );
  const mapName = resolveTarkovMap(validation.value.mapId)?.name ?? validation.value.mapId;
  return discordEphemeralMessage(
    buildDiscordRequestCreatedReply(validation.value.gameMode, mapName, created.outcome),
  );
}

async function buildTwitchPublicReply(
  command: TwitchPublicCommand,
  twitchUserId: string,
  twitchLogin: string,
  deliveryId: string,
  observedAt: Date,
  repository: D1MvpRepository,
  communityConfig: CommunityConfig,
): Promise<string> {
  if (command.name === "request") {
    const parsed = parseTwitchRequestInput(command.input);
    if (!parsed.valid) {
      if (parsed.reason === "missing_mode" || parsed.reason === "unknown_mode") {
        return "Use !request [mode] [map] [goal]. Modes: seasonal, pvp, pve.";
      }
      if (parsed.reason === "missing_map") {
        return "Use !request [mode] [map] [goal].";
      }
      if (parsed.reason === "goal_too_long") {
        return "Keep the goal to 150 characters or fewer.";
      }
      return parsed.suggestion === undefined
        ? "I do not know that map. Use !request [mode] [map] [goal]."
        : `Did you mean ${parsed.suggestion.name}? Try !request ${parsed.gameMode ?? "pve"} ${parsed.suggestion.id} [goal].`;
    }
    const result = await repository.createRequest({
      sourcePlatform: "twitch",
      sourceDeliveryId: deliveryId,
      twitchUserId,
      twitchLogin,
      gameMode: parsed.gameMode,
      inGameName: twitchLogin,
      mapId: parsed.map.id,
      objective: parsed.goal,
      observedAt,
    });
    await materializeRaidBoard(repository, communityConfig, observedAt);
    const raidName = formatModeMap(parsed.gameMode, parsed.map.name);
    return result.outcome === "already_active"
      ? `You are already queued for ${raidName}. Use !queue to check it.`
      : `You are queued for ${raidName}. Use !queue to check it.`;
  }
  const queryService = new QueueQueryService(repository);
  return renderQueueFacts(
    await queryService.queue({ platform: "twitch", userId: twitchUserId }),
    "twitch",
  );
}

async function deliverTwitchReply(input: {
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  repository: D1MvpRepository;
  deliveryId: string;
  replyText: string;
  replyToMessageId?: string;
}): Promise<void> {
  try {
    const messageId = await sendTwitchChatMessage(
      input.environment,
      {
        clientId: input.communityConfig.twitch.clientId,
        botUserId: input.communityConfig.twitch.botUserId,
      },
      {
        broadcasterId: input.communityConfig.twitch.broadcasterUserId,
        message: input.replyText,
        ...(input.replyToMessageId === undefined
          ? {}
          : { replyParentMessageId: input.replyToMessageId }),
      },
    );
    await input.repository.markTwitchReplySent(input.deliveryId, messageId);
  } catch (error) {
    const errorCode = error instanceof TwitchApiError ? error.code : "unexpected_error";
    await input.repository.markTwitchReplyFailed(input.deliveryId, errorCode);
    logDiagnostic("error", "twitch_reply_failed", { errorCode });
  }
}

async function handleTwitchEventSub(
  request: Request,
  environment: CloudflareEnvironment,
  communityConfig: CommunityConfig,
  context: ExecutionContext,
  replyToMessage = true,
): Promise<Response> {
  const rawBody = await request.text();
  const verification = await verifyTwitchEventSubRequest(
    request.headers,
    rawBody,
    requireEnvironmentValue(environment, "TWITCH_EVENTSUB_SECRET"),
    new Date(),
  );
  if (!verification.ok) {
    return new Response("Rejected EventSub delivery", {
      status: verification.reason === "missing_headers" ? 400 : 403,
    });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (verification.headers.messageType === "webhook_callback_verification") {
    const challenge = parseEventSubChallenge(payload);
    if (challenge === undefined) {
      return new Response("Missing challenge", { status: 400 });
    }
    return new Response(challenge, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (verification.headers.messageType === "revocation") {
    logDiagnostic("warn", "twitch_eventsub_revoked", {
      subscriptionType: verification.headers.subscriptionType ?? "unknown",
    });
    return new Response(null, { status: 204 });
  }
  if (
    verification.headers.messageType !== "notification" ||
    verification.headers.subscriptionType !== "channel.chat.message"
  ) {
    return new Response(null, { status: 204 });
  }
  const event = parseTwitchChatMessageEvent(payload);
  if (event === undefined) {
    return new Response("Invalid channel.chat.message payload", { status: 400 });
  }
  if (event.broadcasterUserId !== communityConfig.twitch.broadcasterUserId) {
    return new Response("Unexpected broadcaster", { status: 403 });
  }
  const command = parseTwitchPublicCommand(event.text);
  if (command === undefined) {
    return new Response(null, { status: 204 });
  }
  const observedAt = new Date(verification.headers.messageTimestamp);
  const repository = new D1MvpRepository(environment.DB);
  await repository.materializeWaitingRequests({
    changedAt: observedAt,
    recipientLimit: communityConfig.policies.recipientLimit,
  });
  await repository.observeTwitchIdentity({
    twitchUserId: event.chatterUserId,
    twitchLogin: event.chatterUserLogin,
    observedAt,
  });
  const receipt = await repository.recordTwitchReply({
    deliveryId: verification.headers.messageId,
    eventType: `command:${command.name}`,
    replyText: await buildTwitchPublicReply(
      command,
      event.chatterUserId,
      event.chatterUserLogin,
      verification.headers.messageId,
      observedAt,
      repository,
      communityConfig,
    ),
    ...(replyToMessage ? { replyToMessageId: event.messageId } : {}),
    receivedAt: observedAt,
  });
  if (receipt.replyStatus !== "sent") {
    context.waitUntil(
      deliverTwitchReply({
        environment,
        communityConfig,
        repository,
        deliveryId: verification.headers.messageId,
        replyText: receipt.replyText,
        ...(receipt.replyToMessageId === undefined
          ? {}
          : { replyToMessageId: receipt.replyToMessageId }),
      }),
    );
  }
  if (command.name === "request") {
    context.waitUntil(
      synchronizeCanonicalBoard({
        environment,
        communityConfig,
        changedAt: observedAt,
        createIfMissing: false,
      }).catch(() => undefined),
    );
  }
  return new Response(null, { status: 204 });
}

function hasDiagnosticsAccess(request: Request, environment: CloudflareEnvironment): boolean {
  const expected = `Bearer ${requireEnvironmentValue(environment, "SPIKE_DIAGNOSTICS_TOKEN")}`;
  const actual = request.headers.get("Authorization") ?? "";
  if (expected.length !== actual.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return mismatch === 0;
}

export function createWorker(communityConfigOverride?: CommunityConfig) {
  return {
    async fetch(
      request: Request,
      environment: CloudflareEnvironment,
      context: ExecutionContext,
    ): Promise<Response> {
      return observeWorkerRequest(request, environment, async (measured) => {
        const communityConfig = communityConfigOverride ?? communityConfigFromEnvironment(measured);
        const configurationErrors = validateCommunityConfig(communityConfig);
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/health") {
          return Response.json({
            status: "ok",
            environment: measured.APP_ENV,
            configuration: configurationErrors.length === 0 ? "ready" : "incomplete",
          });
        }
        const isTwitch = request.method === "POST" && url.pathname === "/webhooks/twitch/eventsub";
        const isDiscord =
          request.method === "POST" && url.pathname === "/webhooks/discord/interactions";
        const isStatus = request.method === "GET" && url.pathname === "/internal/status";
        if (!(isTwitch || isDiscord || isStatus)) {
          return new Response("Not found", { status: 404 });
        }
        if (configurationErrors.length > 0) {
          return new Response("Community configuration is incomplete", { status: 503 });
        }
        if (isTwitch) {
          return handleTwitchEventSub(request, measured, communityConfig, context);
        }
        if (isDiscord) {
          return handleDiscordInteraction(request, measured, communityConfig, context);
        }
        if (isStatus) {
          if (!hasDiagnosticsAccess(request, measured)) {
            return new Response("Not found", { status: 404 });
          }
        }
        const [authorization, database] = await Promise.all([
          validateTwitchAuthorization(measured, {
            clientId: communityConfig.twitch.clientId,
            botUserId: communityConfig.twitch.botUserId,
          }),
          new D1MvpRepository(measured.DB).getDiagnostics(),
        ]);
        const recovery = getTwitchAuthorizationRecovery(authorization);
        return Response.json({
          authorization,
          database,
          ...(recovery === undefined ? {} : { recovery }),
        });
      });
    },
  } satisfies ExportedHandler<CloudflareEnvironment>;
}

export default createWorker();
