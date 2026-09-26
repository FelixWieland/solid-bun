import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';

test('native HTTP and database integration uses the same runner', async () => {
  const db = new Database(':memory:');
  db.run('CREATE TABLE messages (text TEXT NOT NULL)');
  db.query('INSERT INTO messages VALUES (?)').run('hello');
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json(db.query('SELECT text FROM messages').all()) });
  try { expect(await (await fetch(server.url)).json()).toEqual([{ text: 'hello' }]); }
  finally { await server.stop(true); db.close(); }
});
