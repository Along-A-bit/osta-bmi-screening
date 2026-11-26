import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Local adapter for the same SQL statements and transactional batches that run on D1.
export function openDatabase(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA foreign_keys = ON');
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='screenings'").get()) {
    sqlite.exec('BEGIN');
    try {
      sqlite.exec(readFileSync(new URL('../drizzle/0000_screening.sql', import.meta.url), 'utf8'));
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  function prepare(sql, params = []) {
    const stmt = sqlite.prepare(sql);
    return {
      bind: (...values) => prepare(sql, values),
      first: () => stmt.get(...params),
      all: () => ({results: stmt.all(...params)}),
      run: () => ({meta: {changes: stmt.run(...params).changes}})
    };
  }
  return {
    prepare,
    batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const rows = statements.map(stmt => stmt.all());
        sqlite.exec('COMMIT');
        return rows;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => sqlite.close()
  };
}
