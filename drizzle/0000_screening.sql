CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  proof_hash TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE screenings (
  id TEXT PRIMARY KEY,
  participant TEXT NOT NULL REFERENCES participants(id),
  submitted_hash TEXT NOT NULL,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  age INTEGER NOT NULL,
  sex TEXT NOT NULL,
  menopause TEXT,
  height REAL NOT NULL,
  weight REAL NOT NULL,
  unit TEXT NOT NULL,
  kg REAL NOT NULL,
  osta INTEGER,
  risk TEXT NOT NULL,
  reason TEXT NOT NULL,
  bmi REAL NOT NULL,
  category TEXT NOT NULL,
  follow TEXT NOT NULL DEFAULT '待跟进',
  version INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE INDEX history_by_person ON screenings(participant,created DESC,id DESC);
--> statement-breakpoint
CREATE INDEX screening_dates ON screenings(created DESC,id DESC);
