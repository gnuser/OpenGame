CREATE TABLE IF NOT EXISTS studio_projects (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  source text NOT NULL DEFAULT 'generated' CHECK (source IN ('generated', 'sample')),
  latest_version_id uuid,
  released_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studio_versions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES studio_projects(id),
  number integer NOT NULL CHECK (number > 0),
  commit_sha text NOT NULL,
  artifact_key text NOT NULL,
  artifact_hash text NOT NULL,
  summary text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('generated', 'sample', 'restore')),
  source_version_id uuid REFERENCES studio_versions(id),
  standards_version text NOT NULL,
  validation jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);
CREATE TABLE IF NOT EXISTS studio_jobs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES studio_projects(id),
  base_version_id uuid REFERENCES studio_versions(id),
  request_key uuid NOT NULL UNIQUE,
  request_hash text NOT NULL,
  prompt text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  phase text NOT NULL DEFAULT 'queued',
  cancel_requested boolean NOT NULL DEFAULT false,
  attempt integer NOT NULL DEFAULT 0,
  lease_token uuid,
  heartbeat_at timestamptz,
  prepared jsonb,
  error text,
  usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS studio_one_active_job ON studio_jobs(project_id) WHERE status IN ('queued', 'running');
CREATE TABLE IF NOT EXISTS studio_messages (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES studio_projects(id),
  job_id uuid REFERENCES studio_jobs(id),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studio_events (
  id serial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES studio_jobs(id),
  phase text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studio_experiences (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL UNIQUE REFERENCES studio_jobs(id),
  project_id uuid NOT NULL REFERENCES studio_projects(id),
  standards_version text NOT NULL,
  outcome text NOT NULL,
  evidence jsonb NOT NULL,
  status text NOT NULL DEFAULT 'observation',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studio_worker_health (
  id integer PRIMARY KEY CHECK (id = 1),
  heartbeat_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS studio_users (
  id uuid PRIMARY KEY,
  label text NOT NULL,
  access_hash text NOT NULL UNIQUE,
  disabled boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  daily_job_limit integer NOT NULL DEFAULT 10 CHECK (daily_job_limit BETWEEN 1 AND 100),
  total_job_limit integer NOT NULL DEFAULT 100 CHECK (total_job_limit BETWEEN 1 AND 10000),
  project_limit integer NOT NULL DEFAULT 10 CHECK (project_limit BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studio_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES studio_users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_sessions_user ON studio_sessions(user_id);
CREATE TABLE IF NOT EXISTS studio_login_limits (
  bucket bigint PRIMARY KEY,
  attempts integer NOT NULL
);
ALTER TABLE studio_projects ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES studio_users(id);
CREATE INDEX IF NOT EXISTS studio_projects_owner ON studio_projects(owner_id);

CREATE TABLE IF NOT EXISTS studio_evolution_candidates (
  id uuid PRIMARY KEY,
  experience_id uuid NOT NULL REFERENCES studio_experiences(id),
  lesson_index integer NOT NULL CHECK (lesson_index BETWEEN 0 AND 2),
  author_id uuid REFERENCES studio_users(id),
  lesson jsonb NOT NULL,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','rejected')),
  review_note text NOT NULL DEFAULT '',
  reviewed_by uuid REFERENCES studio_users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(experience_id,lesson_index,content_hash)
);
CREATE TABLE IF NOT EXISTS studio_knowledge_releases (
  id uuid PRIMARY KEY,
  number serial UNIQUE NOT NULL,
  request_key uuid UNIQUE NOT NULL,
  requested_candidate_ids uuid[] NOT NULL,
  base_release_id uuid REFERENCES studio_knowledge_releases(id),
  label text NOT NULL,
  entries jsonb NOT NULL,
  content_hash text NOT NULL,
  suite_hash text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','passed','failed')),
  report jsonb,
  error text,
  created_by uuid REFERENCES studio_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  published_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS studio_one_evolution_check ON studio_knowledge_releases ((true)) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS studio_public_knowledge (
  id integer PRIMARY KEY CHECK (id=1),
  release_id uuid REFERENCES studio_knowledge_releases(id)
);
INSERT INTO studio_public_knowledge(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS studio_evolution_events (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES studio_users(id),
  action text NOT NULL,
  candidate_id uuid REFERENCES studio_evolution_candidates(id),
  release_id uuid REFERENCES studio_knowledge_releases(id),
  previous_release_id uuid REFERENCES studio_knowledge_releases(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS studio_canvas (
  project_id uuid PRIMARY KEY REFERENCES studio_projects(id),
  revision integer NOT NULL CHECK (revision > 0),
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studio_canvas_assets (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES studio_projects(id),
  name text NOT NULL,
  sha256 text NOT NULL,
  bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 2000000),
  width integer NOT NULL,
  height integer NOT NULL,
  mime text NOT NULL CHECK (mime='image/png'),
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,sha256)
);
ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS canvas_snapshot jsonb;
ALTER TABLE studio_versions ADD COLUMN IF NOT EXISTS canvas_snapshot jsonb;
ALTER TABLE studio_projects ADD COLUMN IF NOT EXISTS draft_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS studio_project_draft_key ON studio_projects(draft_key) WHERE draft_key IS NOT NULL;

ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'build' CHECK (kind IN ('chat','build'));
ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS plan jsonb;
ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS planning_reply text;
ALTER TABLE studio_jobs ADD COLUMN IF NOT EXISTS result_version_id uuid REFERENCES studio_versions(id);
ALTER TABLE studio_versions ADD COLUMN IF NOT EXISTS development_plan jsonb;

CREATE TABLE IF NOT EXISTS studio_game_ratings (
  project_id uuid NOT NULL REFERENCES studio_projects(id),
  voter_key text NOT NULL,
  rating smallint NOT NULL CHECK (rating IN (-1,1)),
  PRIMARY KEY (project_id,voter_key)
);
CREATE TABLE IF NOT EXISTS studio_game_visits (
  project_id uuid NOT NULL REFERENCES studio_projects(id),
  visit_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id,visit_id)
);
