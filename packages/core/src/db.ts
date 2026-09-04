import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

export interface Db {
  readonly connection: DuckDBConnection;
  /** Run a statement, discard the result. */
  exec(sql: string, params?: unknown[]): Promise<void>;
  /** Run a query and return plain JS row objects (BigInt/date values normalised). */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run a query and return the first row, or undefined. */
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  close(): Promise<void>;
}

export interface OpenOptions {
  /** Path to the database file, or ':memory:'. Defaults to config.dbPath. */
  dbPath?: string;
  readOnly?: boolean;
  /** Load the vss extension for vector search. Off by default; the RAG paths turn it on. */
  vss?: boolean;
}

/**
 * DuckDB takes a file lock per process, so a single process must not open the same
 * file twice. Callers that need both read and write access should share one Db.
 */
export async function openDb(options: OpenOptions = {}): Promise<Db> {
  const dbPath = options.dbPath ?? config.dbPath;
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const instance = await DuckDBInstance.create(dbPath, {
    access_mode: options.readOnly ? 'READ_ONLY' : 'READ_WRITE',
    threads: '4',
  });
  const connection = await instance.connect();

  if (options.vss) {
    await connection.run('INSTALL vss');
    await connection.run('LOAD vss');
    // HNSW indexes on a persistent database are still gated behind this flag.
    if (!options.readOnly) {
      await connection.run('SET hnsw_enable_experimental_persistence = true');
    }
  }

  const db: Db = {
    connection,
    async exec(sql, params) {
      if (params && params.length > 0) await connection.run(sql, params as never);
      else await connection.run(sql);
    },
    async all<T>(sql: string, params?: unknown[]) {
      const reader = params && params.length > 0
        ? await connection.runAndReadAll(sql, params as never)
        : await connection.runAndReadAll(sql);
      return reader.getRowObjects().map(normaliseRow) as T[];
    },
    async one<T>(sql: string, params?: unknown[]) {
      const rows = await db.all<T>(sql, params);
      return rows[0];
    },
    async close() {
      connection.closeSync();
      instance.closeSync();
    },
  };

  return db;
}

/**
 * DuckDB hands back BigInt for 64-bit integers and its own wrapper objects for
 * temporal/list types. Those do not survive JSON.stringify, so flatten them here —
 * every consumer (API responses, LLM prompts, tests) wants plain JS values.
 */
export function normaliseValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (Array.isArray(value)) return value.map(normaliseValue);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const obj = value as { toString?: () => string; items?: unknown[] };
    if (Array.isArray(obj.items)) return obj.items.map(normaliseValue);
    if (typeof obj.toString === 'function' && obj.toString !== Object.prototype.toString) {
      return obj.toString();
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normaliseValue(v)]),
    );
  }
  return value;
}

function normaliseRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key] = normaliseValue(value);
  return out;
}
