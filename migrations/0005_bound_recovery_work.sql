DROP INDEX help_requests_queue_order_idx;

CREATE INDEX help_requests_waiting_mode_order_idx
  ON help_requests (is_priority DESC, game_mode, id) WHERE state = 0;
