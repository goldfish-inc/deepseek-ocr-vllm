-- Optional audit column: store Argilla record JSON on pages
-- Execute once in md_annotated if you want to keep raw Argilla payloads for troubleshooting.

ALTER TABLE annotations_pages ADD COLUMN IF NOT EXISTS record_json JSON;
