"""Legacy review tables retained only for additive database upgrades."""

def initialize(db):
    db.executescript('''
        CREATE TABLE IF NOT EXISTS membership_requests (
            member_id TEXT PRIMARY KEY REFERENCES users(id), submitted_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS membership_outbox (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
            member_id TEXT NOT NULL REFERENCES users(id),
            attempts INTEGER NOT NULL DEFAULT 0, available_at REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending', UNIQUE(user_id,member_id));
    ''')
