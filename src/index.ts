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
  type DiscordApplicationCommandInteraction,
  type DiscordMessageComponentInteraction,
  type ParsedDiscordInteraction,
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

function getTwitchAuthorizationRecovery(
  authorization: TwitchAuthorizationHealth,
): { action: "refresh_twitch_app_token"; operatorCommand: "npm run twitch:token" } | undefined {
  if (authorization.ok || !["revoked_or_expired", "wrong_client"].includes(authorization.reason)) {
    return undefined;
  }
  return { action: "refresh_twitch_app_token", operatorCommand: "npm run twitch:token" };
}

type DiscordModalSubmitInteraction = Extract<ParsedDiscordInteraction, { type: "modal_submit" }>;
type UserDirectoryAction = NonNullable<ReturnType<typeof parseUserDirectoryAction>>;
type UserDirectoryEditAction = Extract<UserDirectoryAction, { twitchLogin: string }>;

interface DiscordInteractionDependencies {
  environment: CloudflareEnvironment;
  communityConfig: CommunityConfig;
  context: ExecutionContext;
  changedAt: Date;
  repository: D1MvpRepository;
}

async function claimDiscordMutation(
  dependencies: DiscordInteractionDependencies,
  deliveryId: string,
  eventType: string,
): Promise<boolean> {
  const claimed = await dependencies.repository.claimDiscordMutation(
    deliveryId,
    eventType,
    dependencies.changedAt,
  );
  if (claimed) {
    dependencies.context.waitUntil(
      dependencies.repository
        .maintainExpiredReceipts(dependencies.changedAt)
        .catch(() => undefined),
    );
  }
  return claimed;
}

async function handleStaffInsightsCommand(
  interaction: DiscordApplicationCommandInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const { communityConfig, repository } = dependencies;
  if (!hasStaffAccess(interaction, communityConfig)) return staffDenied();
  if (interaction.commandName === DISCORD_STAFF_STATS_COMMAND) {
    const service = new StaffStatisticsQueryService(repository);
    return discordEphemeralInsights(renderStaffStatistics(await service.getAllTime()));
  }
  return discordEphemeralInsights(
    renderUserDirectory(await repository.getUserDirectoryPage({ direction: "first" })),
  );
}

async function handleDiscordRequestCommand(
  interaction: DiscordApplicationCommandInteraction,
  repository: D1MvpRepository,
): Promise<Response> {
  const gameMode = parseGameMode(interaction.options.mode);
  if (gameMode === undefined) {
    return discordEphemeralMessage("Select PvP Seasonal, PvP, or PvE, then try again.");
  }
  const mapping = await repository.findUserMappingByDiscordId(interaction.discordUserId);
  let defaults: Parameters<typeof buildDiscordRequestModal>[1];
  if (mapping !== undefined) {
    defaults = { twitchLogin: mapping.twitchLogin };
    if (mapping.inGameName !== undefined) defaults.inGameName = mapping.inGameName;
  }
  return Response.json({
    type: DISCORD_INTERACTION_RESPONSE_MODAL,
    data: buildDiscordRequestModal(gameMode, defaults),
  });
}

async function handleDiscordLinkCommand(
  interaction: DiscordApplicationCommandInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const { communityConfig, changedAt, repository } = dependencies;
  const twitchLogin = parseTwitchNameOption(interaction.options.name);
  if (twitchLogin === undefined) {
    return discordEphemeralMessage("Enter a Twitch name using letters, numbers, or underscore.");
  }
  const rawEftName = interaction.options.eft;
  const inGameName = parseEftNameOption(rawEftName);
  if (rawEftName !== undefined && inGameName === undefined) {
    return discordEphemeralMessage("Enter an Escape from Tarkov name between 1 and 64 characters.");
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
  const claimed = await claimDiscordMutation(
    dependencies,
    interaction.interactionId,
    "identity:link-twitch",
  );
  if (!claimed) return discordEphemeralMessage("That link command was already received.");
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

async function handleDiscordQueueCommand(
  interaction: DiscordApplicationCommandInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const { repository } = dependencies;
  const queryService = new QueueQueryService(repository);
  return discordEphemeralMessage(
    renderQueueFacts(
      await queryService.queue({ platform: "discord", userId: interaction.discordUserId }),
      "discord",
    ),
  );
}

async function handleDiscordApplicationCommand(
  interaction: DiscordApplicationCommandInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  if (
    interaction.commandName === DISCORD_STAFF_STATS_COMMAND ||
    interaction.commandName === DISCORD_STAFF_USERS_COMMAND
  ) {
    return handleStaffInsightsCommand(interaction, dependencies);
  }
  if (interaction.commandName === DISCORD_STAFF_BOARD_COMMAND) {
    return openDiscordStaffBoard(interaction, dependencies);
  }
  if (interaction.commandName === DISCORD_REQUEST_COMMAND) {
    return handleDiscordRequestCommand(interaction, dependencies.repository);
  }
  if (interaction.commandName === DISCORD_LINK_TWITCH_COMMAND) {
    return handleDiscordLinkCommand(interaction, dependencies);
  }
  if (interaction.commandName === "queue") {
    return handleDiscordQueueCommand(interaction, dependencies);
  }
  return new Response("Unsupported application command", { status: 400 });
}

function updatedUserDetail(
  outcome: "updated" | "stale",
  entry: Awaited<ReturnType<D1MvpRepository["findUserMappingByTwitchLogin"]>>,
  pageFirst: string,
): Response {
  if (outcome === "updated" && entry !== undefined) {
    return discordUpdateInsights(renderUserDetail(entry, pageFirst));
  }
  return discordEphemeralMessage("User details changed. Open `/users` again.");
}

async function completeMissingDiscord(
  interaction: DiscordMessageComponentInteraction,
  action: UserDirectoryEditAction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const { repository, changedAt } = dependencies;
  const discordUserId = interaction.values[0];
  const hasResolvedMember =
    discordUserId !== undefined && Object.hasOwn(interaction.resolvedRoleIdsByUser, discordUserId);
  if (!hasResolvedMember || discordUserId === undefined) {
    return discordEphemeralMessage("Select a current member of this Discord server.");
  }
  const claimed = await claimDiscordMutation(
    dependencies,
    interaction.interactionId,
    "identity:complete-discord",
  );
  if (!claimed) {
    return discordEphemeralMessage("That user update was already received. Open `/users` again.");
  }
  try {
    const discordDisplayName = interaction.resolvedUserDisplayNames[discordUserId];
    const outcome = await repository.completeMissingDiscord({
      twitchLogin: action.twitchLogin,
      discordUserId,
      ...(discordDisplayName === undefined ? {} : { discordDisplayName }),
      changedAt,
    });
    const entry = await repository.findUserMappingByTwitchLogin(action.twitchLogin);
    return updatedUserDetail(outcome, entry, action.pageFirst);
  } catch {
    return discordEphemeralMessage(
      "That Discord member is already linked. Use `/link-twitch` to correct the association.",
    );
  }
}

async function handleUserDirectoryComponent(
  interaction: DiscordMessageComponentInteraction,
  action: UserDirectoryAction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const { communityConfig, repository } = dependencies;
  if (!hasStaffAccess(interaction, communityConfig)) return staffDenied();
  if (action.action === "next" || action.action === "previous" || action.action === "at") {
    const page = await repository.getUserDirectoryPage({
      direction: action.action,
      cursor: action.cursor,
    });
    return discordUpdateInsights(renderUserDirectory(page));
  }
  if (action.action === "detail") {
    const twitchLogin = interaction.values[0];
    const entry =
      twitchLogin === undefined
        ? undefined
        : await repository.findUserMappingByTwitchLogin(twitchLogin);
    if (entry === undefined) {
      return discordEphemeralMessage("Open `/users` again and select a current user.");
    }
    return discordUpdateInsights(renderUserDetail(entry, action.pageFirst));
  }
  if (action.action === "add_eft") {
    return Response.json({
      type: DISCORD_INTERACTION_RESPONSE_MODAL,
      data: buildEftNameModal(action.twitchLogin, action.pageFirst),
    });
  }
  if (action.action === "add_discord") {
    return completeMissingDiscord(interaction, action, dependencies);
  }
  return discordEphemeralMessage("Open `/users` again and use a current control.");
}

async function handleDiscordMessageComponent(
  interaction: DiscordMessageComponentInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const directoryAction = parseUserDirectoryAction(interaction.customId);
  if (directoryAction !== undefined) {
    return handleUserDirectoryComponent(interaction, directoryAction, dependencies);
  }
  const isBoardControl =
    parseStaffBoardAction(interaction.customId) !== undefined ||
    parseRaidMessageAction(interaction.customId) !== undefined;
  if (isBoardControl) {
    return handleDiscordStaffBoardComponent(interaction, dependencies);
  }
  if (interaction.customId.startsWith("users:")) {
    return discordEphemeralMessage("Open `/users` again and use a current control.");
  }
  return new Response("Unsupported component", { status: 400 });
}

async function handleUserDirectoryEftModal(
  interaction: DiscordModalSubmitInteraction,
  action: UserDirectoryEditAction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const { communityConfig, repository, changedAt } = dependencies;
  if (!hasStaffAccess(interaction, communityConfig)) return staffDenied();
  const inGameName = interaction.values[USER_DIRECTORY_EFT_FIELD]?.trim();
  if (inGameName === undefined || inGameName.length < 1 || inGameName.length > 64) {
    return discordEphemeralMessage("Enter an Escape from Tarkov name from 1 to 64 characters.");
  }
  const claimed = await claimDiscordMutation(
    dependencies,
    interaction.interactionId,
    "identity:complete-eft",
  );
  if (!claimed) {
    return discordEphemeralMessage("That user update was already received. Open `/users` again.");
  }
  const outcome = await repository.completeMissingInGameName({
    twitchLogin: action.twitchLogin,
    inGameName,
    changedAt,
  });
  const entry = await repository.findUserMappingByTwitchLogin(action.twitchLogin);
  return updatedUserDetail(outcome, entry, action.pageFirst);
}

async function handleDiscordRequestModal(
  interaction: DiscordModalSubmitInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const { environment, communityConfig, context, changedAt, repository } = dependencies;
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
  await claimDiscordMutation(dependencies, interaction.interactionId, "request:create");
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
    recipientLimit: communityConfig.policies.recipientLimit,
    observedAt: changedAt,
  });
  if (created.queueChanged) {
    context.waitUntil(
      synchronizeCanonicalBoard({
        environment,
        communityConfig,
        changedAt,
        createIfMissing: false,
      }).catch(() => undefined),
    );
  }
  const mapName = resolveTarkovMap(validation.value.mapId)?.name ?? validation.value.mapId;
  return discordEphemeralMessage(
    buildDiscordRequestCreatedReply(validation.value.gameMode, mapName, created.outcome),
  );
}

async function handleDiscordModalSubmit(
  interaction: DiscordModalSubmitInteraction,
  dependencies: DiscordInteractionDependencies,
): Promise<Response> {
  const userAction = parseUserDirectoryAction(interaction.customId);
  if (userAction?.action === "add_eft") {
    return handleUserDirectoryEftModal(interaction, userAction, dependencies);
  }
  if (interaction.customId.startsWith("users:")) {
    return discordEphemeralMessage("Open `/users` again and use a current control.");
  }
  return handleDiscordRequestModal(interaction, dependencies);
}

async function handleDiscordInteraction(
  request: Request,
  environment: CloudflareEnvironment,
  communityConfig: CommunityConfig,
  context: ExecutionContext,
): Promise<Response> {
  const rawBody = await request.text();
  const verified = await verifyDiscordInteractionRequest(
    request.headers,
    rawBody,
    communityConfig.discord.publicKey,
    new Date(),
  );
  if (!verified) return new Response("Invalid request signature", { status: 401 });
  const parsedBody = parseJsonBody(rawBody);
  if (!parsedBody.ok) return new Response("Invalid JSON", { status: 400 });
  const interaction = parseDiscordInteraction(parsedBody.payload);
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
  const dependencies: DiscordInteractionDependencies = {
    environment,
    communityConfig,
    context,
    changedAt: readDiscordInteractionTimestamp(request.headers),
    repository: new D1MvpRepository(environment.DB),
  };
  if (interaction.type === "application_command") {
    return handleDiscordApplicationCommand(interaction, dependencies);
  }
  if (interaction.type === "message_component") {
    return handleDiscordMessageComponent(interaction, dependencies);
  }
  return handleDiscordModalSubmit(interaction, dependencies);
}

async function buildTwitchPublicReply(
  command: TwitchPublicCommand,
  twitchUserId: string,
  twitchLogin: string,
  deliveryId: string,
  observedAt: Date,
  repository: D1MvpRepository,
  communityConfig: CommunityConfig,
): Promise<{ replyText: string; boardChanged: boolean }> {
  if (command.name === "request") {
    const parsed = parseTwitchRequestInput(command.input);
    if (!parsed.valid) {
      return { replyText: invalidTwitchRequestReply(parsed), boardChanged: false };
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
      recipientLimit: communityConfig.policies.recipientLimit,
      observedAt,
    });
    const raidName = formatModeMap(parsed.gameMode, parsed.map.name);
    return {
      replyText:
        result.outcome === "already_active"
          ? `You are already queued for ${raidName}. Use !queue to check it.`
          : `You are queued for ${raidName}. Use !queue to check it.`,
      boardChanged: result.queueChanged,
    };
  }
  await repository.observeTwitchIdentity({
    twitchUserId,
    twitchLogin,
    observedAt,
  });
  const queryService = new QueueQueryService(repository);
  return {
    replyText: renderQueueFacts(
      await queryService.queue({ platform: "twitch", userId: twitchUserId }),
      "twitch",
    ),
    boardChanged: false,
  };
}

type InvalidTwitchRequest = Extract<ReturnType<typeof parseTwitchRequestInput>, { valid: false }>;

function invalidTwitchRequestReply(parsed: InvalidTwitchRequest): string {
  if (parsed.reason === "missing_mode" || parsed.reason === "unknown_mode") {
    return "Use !request [mode] [map] [goal]. Modes: seasonal, pvp, pve.";
  }
  if (parsed.reason === "missing_map") {
    return "Use !request [mode] [map] [goal].";
  }
  if (parsed.reason === "goal_too_long") {
    return "Keep the goal to 150 characters or fewer.";
  }
  if (parsed.suggestion === undefined) {
    return "I do not know that map. Use !request [mode] [map] [goal].";
  }
  return `Did you mean ${parsed.suggestion.name}? Try !request ${parsed.gameMode ?? "pve"} ${parsed.suggestion.id} [goal].`;
}

type VerifiedEventSubHeaders = Extract<
  Awaited<ReturnType<typeof verifyTwitchEventSubRequest>>,
  { ok: true }
>["headers"];
type TwitchChatEvent = NonNullable<ReturnType<typeof parseTwitchChatMessageEvent>>;

function parseJsonBody(rawBody: string): { ok: true; payload: unknown } | { ok: false } {
  try {
    return { ok: true, payload: JSON.parse(rawBody) };
  } catch {
    return { ok: false };
  }
}

function eventSubControlResponse(
  headers: VerifiedEventSubHeaders,
  payload: unknown,
): Response | undefined {
  if (headers.messageType === "webhook_callback_verification") {
    const challenge = parseEventSubChallenge(payload);
    if (challenge === undefined) return new Response("Missing challenge", { status: 400 });
    return new Response(challenge, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (headers.messageType === "revocation") {
    logDiagnostic("warn", "twitch_eventsub_revoked", {
      subscriptionType: headers.subscriptionType ?? "unknown",
    });
    return new Response(null, { status: 204 });
  }
  if (
    headers.messageType !== "notification" ||
    headers.subscriptionType !== "channel.chat.message"
  ) {
    return new Response(null, { status: 204 });
  }
  return undefined;
}

function acceptedTwitchChatEvent(
  payload: unknown,
  broadcasterUserId: string,
): TwitchChatEvent | Response {
  const event = parseTwitchChatMessageEvent(payload);
  if (event === undefined) {
    return new Response("Invalid channel.chat.message payload", { status: 400 });
  }
  if (event.broadcasterUserId !== broadcasterUserId) {
    return new Response("Unexpected broadcaster", { status: 403 });
  }
  return event;
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
  const parsedBody = parseJsonBody(rawBody);
  if (!parsedBody.ok) {
    return new Response("Invalid JSON", { status: 400 });
  }
  const controlResponse = eventSubControlResponse(verification.headers, parsedBody.payload);
  if (controlResponse !== undefined) return controlResponse;
  const acceptedEvent = acceptedTwitchChatEvent(
    parsedBody.payload,
    communityConfig.twitch.broadcasterUserId,
  );
  if (acceptedEvent instanceof Response) return acceptedEvent;
  const event = acceptedEvent;
  const command = parseTwitchPublicCommand(event.text);
  if (command === undefined) {
    return new Response(null, { status: 204 });
  }
  const observedAt = new Date(verification.headers.messageTimestamp);
  const repository = new D1MvpRepository(environment.DB);
  const commandResult = await buildTwitchPublicReply(
    command,
    event.chatterUserId,
    event.chatterUserLogin,
    verification.headers.messageId,
    observedAt,
    repository,
    communityConfig,
  );
  const receipt = await repository.recordTwitchReply({
    deliveryId: verification.headers.messageId,
    eventType: `command:${command.name}`,
    replyText: commandResult.replyText,
    ...(replyToMessage ? { replyToMessageId: event.messageId } : {}),
    receivedAt: observedAt,
  });
  if (!receipt.duplicate) {
    context.waitUntil(repository.maintainExpiredReceipts(observedAt).catch(() => undefined));
  }
  const shouldDeliver =
    (!receipt.duplicate && receipt.replyStatus === "pending") ||
    (receipt.duplicate &&
      receipt.replyStatus === "failed" &&
      (await repository.claimFailedTwitchReplyRetry(verification.headers.messageId)));
  if (shouldDeliver) {
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
  if (commandResult.boardChanged) {
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
    mismatch |= (expected.codePointAt(index) ?? 0) ^ (actual.codePointAt(index) ?? 0);
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
        const isLegacyRepair =
          request.method === "POST" && url.pathname === "/internal/repair-unassigned-requests";
        if (!(isTwitch || isDiscord || isStatus || isLegacyRepair)) {
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
        if (isStatus || isLegacyRepair) {
          if (!hasDiagnosticsAccess(request, measured)) {
            return new Response("Not found", { status: 404 });
          }
        }
        if (isLegacyRepair) {
          const repository = new D1MvpRepository(measured.DB);
          const result = await repository.repairLegacyUnassignedRequests({
            recipientLimit: communityConfig.policies.recipientLimit,
            changedAt: new Date(),
          });
          if (result.repaired > 0 && !result.hasMore) {
            await synchronizeCanonicalBoard({
              environment: measured,
              communityConfig,
              changedAt: new Date(),
              createIfMissing: false,
            });
          }
          return Response.json(result);
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
