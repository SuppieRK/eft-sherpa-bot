export type QueueCaller =
  | { platform: "discord"; userId: string }
  | { platform: "twitch"; userId: string };

export const QUEUE_REQUEST_EXACT_LIMIT = 100;
export const QUEUE_RAID_EXACT_LIMIT = 50;

type QueuePosition =
  | { kind: "exact"; ordinal: number }
  | { kind: "more_than"; requestsAhead: typeof QUEUE_REQUEST_EXACT_LIMIT };

type QueueRaidsAhead =
  | { kind: "exact"; count: number }
  | { kind: "more_than"; count: typeof QUEUE_RAID_EXACT_LIMIT };

interface CallerQueueFacts {
  mapName: string;
  queuePosition: QueuePosition;
  raidsAhead: QueueRaidsAhead;
  otherActiveMapNames: string[];
}

export interface QueueFacts {
  caller?: CallerQueueFacts;
}

export interface QueueQueryRepository {
  getQueueFacts(caller: QueueCaller): Promise<QueueFacts>;
}

export class QueueQueryService {
  constructor(private readonly repository: QueueQueryRepository) {}

  queue(caller: QueueCaller): Promise<QueueFacts> {
    return this.repository.getQueueFacts(caller);
  }
}
