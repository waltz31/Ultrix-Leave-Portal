import './time.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { isPostgres, translateSql, toPgPlaceholders } from './sqlDialect.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function wrapSqlite(raw) {
  return {
    dialect: 'sqlite',
    ready: Promise.resolve(),
    prepare(sql) {
      const stmt = raw.prepare(sql);
      return {
        get: async (...params) => stmt.get(...params),
        all: async (...params) => stmt.all(...params),
        run: async (...params) => stmt.run(...params),
      };
    },
    exec: async (sql) => {
      raw.exec(sql);
    },
    async transaction(fn) {
      return fn();
    },
  };
}

function createPostgres() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_SSL === 'false'
        ? false
        : { rejectUnauthorized: false },
    max: 10,
  });

  function clientQuery(client, sql, params) {
    const translated = toPgPlaceholders(translateSql(sql));
    return client.query(translated, params);
  }

  function makePrepare(queryFn) {
    return (sql) => ({
      get: async (...params) => {
        const { rows } = await queryFn(sql, params);
        return rows[0];
      },
      all: async (...params) => {
        const { rows } = await queryFn(sql, params);
        return rows;
      },
      run: async (...params) => {
        let text = sql;
        if (/^\s*INSERT\s+/i.test(text) && !/RETURNING\b/i.test(text)) {
          text = `${text.replace(/;?\s*$/, '')} RETURNING id`;
        }
        const result = await queryFn(text, params);
        return {
          lastInsertRowid: result.rows[0]?.id ?? 0,
          changes: result.rowCount ?? 0,
        };
      },
    });
  }

  const adapter = {
    dialect: 'postgres',
    prepare: makePrepare((sql, params) => clientQuery(pool, sql, params)),
    exec: async (sql) => {
      await pool.query(translateSql(sql));
    },
    async transaction(fn) {
      const client = await pool.connect();
      const prevPrepare = adapter.prepare;
      try {
        await client.query('BEGIN');
        adapter.prepare = makePrepare((sql, params) => clientQuery(client, sql, params));
        const result = await fn();
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore
        }
        throw err;
      } finally {
        adapter.prepare = prevPrepare;
        client.release();
      }
    },
    ready: Promise.resolve(),
  };

  async function initSchema() {
    const schemaPath = path.join(__dirname, 'schema.pg.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const statements = schema
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('--'));
    for (const statement of statements) {
      await pool.query(statement);
    }
    console.log('Connected to Supabase/Postgres');
  }

  adapter.ready = initSchema();
  return adapter;
}

let db;
if (isPostgres) {
  db = createPostgres();
} else {
  const { default: sqlite } = await import('./sqliteInit.js');
  db = wrapSqlite(sqlite);
}

export default db;
