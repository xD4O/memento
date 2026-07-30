-- Memento schema v1 (Phase 0: users, entries, segments, annotations)
-- Derived-data rule: everything except users, entries' media, and user-authored
-- annotations can be rebuilt from raw media.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  journal_started_on date NOT NULL DEFAULT current_date,
  settings           jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  kind        text NOT NULL DEFAULT 'video_log'
              CHECK (kind IN ('video_log','audio_log','live_session')),
  status      text NOT NULL DEFAULT 'created'
              CHECK (status IN ('created','uploaded','transcribing','indexed','error','sealed')),
  error       text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  sol         integer NOT NULL DEFAULT 0,
  duration_s  real,
  media_uri   text,
  media_mime  text,
  thumb_uri   text,
  title       text,
  summary     text,
  mood        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS entries_user_time
  ON entries (user_id, recorded_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS entries_queue
  ON entries (status, created_at) WHERE status = 'uploaded';

CREATE TABLE IF NOT EXISTS segments (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  idx      integer NOT NULL,
  t_start  real NOT NULL,
  t_end    real NOT NULL,
  speaker  text NOT NULL DEFAULT 'user' CHECK (speaker IN ('user','agent')),
  text     text NOT NULL,
  words    jsonb,
  embedding vector(768),  -- nomic-embed-text; derived, rebuildable
  ts       tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
  UNIQUE (entry_id, idx)
);

CREATE INDEX IF NOT EXISTS segments_fts ON segments USING gin (ts);

CREATE TABLE IF NOT EXISTS annotations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id   uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  segment_id bigint REFERENCES segments(id) ON DELETE SET NULL,
  t_start    real,
  t_end      real,
  type       text NOT NULL DEFAULT 'flag'
             CHECK (type IN ('flag','highlight','action_item','insight')),
  source     text NOT NULL DEFAULT 'user' CHECK (source IN ('user','agent')),
  label      text NOT NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS annotations_entry
  ON annotations (entry_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS concepts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  name       text NOT NULL,
  kind       text NOT NULL DEFAULT 'idea'
             CHECK (kind IN ('person','place','project','idea','theme','emotion','other')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS concepts_user_name
  ON concepts (user_id, lower(name));

CREATE TABLE IF NOT EXISTS entry_concepts (
  entry_id   uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  concept_id uuid NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  salience   real NOT NULL DEFAULT 0.5,
  PRIMARY KEY (entry_id, concept_id)
);

CREATE INDEX IF NOT EXISTS entry_concepts_concept ON entry_concepts (concept_id);

CREATE TABLE IF NOT EXISTS threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  title           text NOT NULL,
  detail          text,
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','resolved','dropped')),
  source_entry_id uuid REFERENCES entries(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS threads_open
  ON threads (user_id, updated_at DESC) WHERE status = 'open' AND deleted_at IS NULL;

-- The rapport model: what the agent knows about the journaler. Always
-- user-visible and user-editable (plan §5 trust requirement).
CREATE TABLE IF NOT EXISTS profile_facts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  category        text NOT NULL DEFAULT 'context'
                  CHECK (category IN ('value','goal','person','preference','sensitivity','context')),
  fact            text NOT NULL,
  source          text NOT NULL DEFAULT 'agent' CHECK (source IN ('agent','user')),
  source_entry_id uuid REFERENCES entries(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS profile_facts_live
  ON profile_facts (user_id, category) WHERE deleted_at IS NULL;

-- Pins: reminders (date-anchored) and notes the journaler asked to keep.
-- Created by the reflection pass, the live agent's create_pin tool, or by hand.
CREATE TABLE IF NOT EXISTS pins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  kind            text NOT NULL DEFAULT 'note' CHECK (kind IN ('reminder','note')),
  text            text NOT NULL,
  due_on          date,
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','done','dismissed')),
  source          text NOT NULL DEFAULT 'agent' CHECK (source IN ('agent','user')),
  source_entry_id uuid REFERENCES entries(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS pins_active
  ON pins (user_id, due_on) WHERE status = 'active' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS daily_summaries (
  user_id     uuid NOT NULL REFERENCES users(id),
  day         date NOT NULL,
  summary     text,
  highlights  jsonb,
  mood        text,
  entry_count integer NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS weekly_summaries (
  user_id     uuid NOT NULL REFERENCES users(id),
  week_start  date NOT NULL,  -- Monday
  summary     text,
  highlights  jsonb,
  patterns    text,
  mood        text,
  entry_count integer NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start)
);

-- Life Story program: a long-form interview the agent conducts over weeks.
CREATE TABLE IF NOT EXISTS story_topics (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id),
  chapter      text NOT NULL,
  prompt       text NOT NULL,
  ord          integer NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped')),
  entry_id     uuid REFERENCES entries(id) ON DELETE SET NULL,
  completed_at timestamptz,
  UNIQUE (user_id, prompt)
);

-- Additive migrations (idempotent) for databases created before these columns
ALTER TABLE entries ADD COLUMN IF NOT EXISTS thumb_uri text;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS cost_usd real;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS deliver_on date;  -- time capsules
ALTER TABLE entries ADD COLUMN IF NOT EXISTS vision jsonb;     -- visual log
ALTER TABLE weekly_summaries ADD COLUMN IF NOT EXISTS recap_uri text;
ALTER TABLE profile_facts ADD COLUMN IF NOT EXISTS embedding vector(768);
ALTER TABLE entries DROP CONSTRAINT IF EXISTS entries_status_check;
ALTER TABLE entries ADD CONSTRAINT entries_status_check
  CHECK (status IN ('created','uploaded','transcribing','indexed','error','sealed'));
ALTER TABLE segments ADD COLUMN IF NOT EXISTS embedding vector(768);
CREATE INDEX IF NOT EXISTS segments_embedding_hnsw
  ON segments USING hnsw (embedding vector_cosine_ops);

-- Single-user phase: fixed operator id (multi-tenant-shaped, per plan R-03)
INSERT INTO users (id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Archive: entries set aside from the timeline without deleting them.
-- Trash is deleted_at (recoverable); archive is archived_at (intentional).
ALTER TABLE entries ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS entries_archived ON entries (user_id, archived_at DESC)
  WHERE archived_at IS NOT NULL AND deleted_at IS NULL;
