ALTER TABLE event_receipts
ADD COLUMN discord_claim_token TEXT;

ALTER TABLE event_receipts
ADD COLUMN twitch_processing_until INTEGER
  CHECK (twitch_processing_until IS NULL OR twitch_processing_until >= 0);

ALTER TABLE event_receipts
ADD COLUMN twitch_processing_token TEXT;

ALTER TABLE event_receipts
ADD COLUMN twitch_send_token TEXT;

CREATE TRIGGER user_mappings_stable_identity_update
BEFORE UPDATE OF twitch_user_id ON user_mappings
WHEN OLD.twitch_user_id IS NOT NULL
  AND NEW.twitch_user_id IS NOT NULL
  AND OLD.twitch_user_id <> NEW.twitch_user_id
BEGIN
  SELECT RAISE(ABORT, 'stable Twitch identity conflict');
END;
