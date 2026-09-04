import { describe, expect, it } from 'vitest';
import { guardSql, SqlGuardError, tokenise } from '../src/sqlGuard.ts';

/** Asserts the guard rejects `sql`, and for the stated reason. */
function expectRejected(sql: string, reason: string) {
  try {
    guardSql(sql);
  } catch (error) {
    expect(error, `expected SqlGuardError for: ${sql}`).toBeInstanceOf(SqlGuardError);
    expect((error as SqlGuardError).reason, `wrong reason for: ${sql}`).toBe(reason);
    return;
  }
  throw new Error(`guard accepted SQL it should have rejected: ${sql}`);
}

describe('guardSql: statements it accepts', () => {
  it('accepts a plain SELECT over an allowed view', () => {
    const result = guardSql('SELECT gene, mean_plddt FROM v_protein_overview');
    expect(result.relations).toEqual(['v_protein_overview']);
    expect(result.limitApplied).toBe(true);
    expect(result.sql).toContain('LIMIT 200');
  });

  it('leaves an existing LIMIT alone', () => {
    const sql = 'SELECT gene FROM v_protein_overview ORDER BY mean_plddt LIMIT 10';
    const result = guardSql(sql);
    expect(result.limitApplied).toBe(false);
    expect(result.sql).toBe(sql);
  });

  it('accepts a CTE and records only real relations', () => {
    const result = guardSql(`
      WITH disordered AS (
        SELECT accession, length FROM v_low_confidence_segments WHERE length > 30
      )
      SELECT accession, sum(length) AS total FROM disordered GROUP BY accession LIMIT 20
    `);
    expect(result.relations).toEqual(['v_low_confidence_segments']);
  });

  it('accepts a join between two allowed views', () => {
    const result = guardSql(`
      SELECT o.gene, s.start_residue
      FROM v_protein_overview o
      JOIN v_low_confidence_segments s ON s.accession = o.accession
      LIMIT 5
    `);
    expect(result.relations.sort()).toEqual([
      'v_low_confidence_segments',
      'v_protein_overview',
    ]);
  });

  it('accepts a subquery in FROM', () => {
    expect(() =>
      guardSql('SELECT * FROM (SELECT gene FROM v_protein_overview) t LIMIT 5'),
    ).not.toThrow();
  });

  it('accepts string literals that merely contain scary words', () => {
    const result = guardSql("SELECT gene FROM v_protein_overview WHERE gene = 'DROP TABLE users'");
    expect(result.relations).toEqual(['v_protein_overview']);
  });

  it('tolerates a trailing semicolon', () => {
    expect(() => guardSql('SELECT 1 FROM v_protein_overview LIMIT 1;')).not.toThrow();
  });

  it('is case insensitive', () => {
    expect(() => guardSql('select GENE from V_PROTEIN_OVERVIEW limit 3')).not.toThrow();
  });
});

describe('guardSql: statements it rejects', () => {
  it('rejects anything that is not a SELECT', () => {
    expectRejected('DROP TABLE proteins', 'not_a_select');
    expectRejected('DELETE FROM proteins', 'not_a_select');
    expectRejected('UPDATE proteins SET gene = NULL', 'not_a_select');
    expectRejected('INSERT INTO proteins VALUES (1)', 'not_a_select');
    expectRejected('ATTACH \'evil.db\' AS evil', 'not_a_select');
    expectRejected('PRAGMA database_list', 'not_a_select');
  });

  it('rejects a second statement smuggled in after a semicolon', () => {
    expectRejected('SELECT 1 FROM v_protein_overview; DROP TABLE proteins', 'multiple_statements');
    expectRejected('SELECT 1 FROM v_protein_overview;;', 'multiple_statements');
  });

  it('rejects a statement hidden behind a comment', () => {
    // The comment is stripped, exposing the second statement rather than hiding it.
    expectRejected(
      'SELECT 1 FROM v_protein_overview -- harmless\n; DROP TABLE proteins',
      'multiple_statements',
    );
    expectRejected(
      'SELECT 1 FROM v_protein_overview /* x */ ; COPY proteins TO \'/tmp/out.csv\'',
      'multiple_statements',
    );
  });

  it('rejects side-effecting keywords inside an otherwise valid SELECT', () => {
    expectRejected(
      'SELECT * FROM v_protein_overview WHERE accession IN (SELECT 1) UNION SELECT * FROM (COPY x TO \'y\')',
      'forbidden_keyword',
    );
    expectRejected('WITH x AS (SELECT 1) SELECT * FROM x, (INSTALL httpfs)', 'forbidden_keyword');
  });

  it('rejects file-reading functions', () => {
    expectRejected("SELECT * FROM read_csv('/etc/passwd')", 'forbidden_function');
    expectRejected("SELECT * FROM read_parquet('s3://bucket/x.parquet')", 'forbidden_function');
    expectRejected("SELECT read_text('/etc/passwd') FROM v_protein_overview", 'forbidden_function');
    expectRejected('SELECT getenv(\'AFX_S3_SECRET_KEY\') FROM v_protein_overview', 'forbidden_function');
    expectRejected('SELECT * FROM duckdb_settings()', 'forbidden_function');
  });

  it('rejects reading a file path directly', () => {
    expectRejected("SELECT * FROM '/etc/passwd'", 'unknown_relation');
    expectRejected("SELECT * FROM 'https://evil.example/x.parquet'", 'unknown_relation');
  });

  it('rejects base tables and unknown relations', () => {
    expectRejected('SELECT * FROM proteins', 'unknown_relation');
    expectRejected('SELECT * FROM annotations', 'unknown_relation');
    expectRejected('SELECT * FROM sqlite_master', 'unknown_relation');
    expectRejected('SELECT * FROM information_schema.tables', 'unknown_relation');
  });

  it('rejects qualified names that reach past the allowlist', () => {
    expectRejected('SELECT * FROM main.proteins', 'unknown_relation');
    expectRejected('SELECT * FROM other.main.v_protein_overview', 'unknown_relation');
  });

  it('rejects a join onto a disallowed relation even when the first one is fine', () => {
    expectRejected(
      'SELECT * FROM v_protein_overview JOIN proteins USING (accession)',
      'unknown_relation',
    );
  });

  it('does not let a quoted identifier launder a table name', () => {
    expectRejected('SELECT * FROM "proteins"', 'unknown_relation');
  });

  it('rejects table functions', () => {
    expectRejected('SELECT * FROM range(10)', 'forbidden_function');
  });

  it('rejects empty and malformed input', () => {
    expectRejected('', 'empty');
    expectRejected('   -- just a comment\n', 'empty');
    expectRejected(';', 'empty');
    expectRejected("SELECT 'unterminated FROM v_protein_overview", 'unterminated_literal');
    expectRejected('SELECT 1 /* unterminated FROM v_protein_overview', 'unterminated_literal');
  });
});

describe('tokenise', () => {
  it('keeps a doubled quote inside a string literal', () => {
    const tokens = tokenise("SELECT 'it''s fine'");
    expect(tokens[1]).toMatchObject({ kind: 'string', value: "it's fine" });
  });

  it('drops comments entirely', () => {
    expect(tokenise('SELECT 1 -- comment\n, 2').map((t) => t.value)).toEqual([
      'SELECT',
      '1',
      ',',
      '2',
    ]);
  });

  it('treats a double-quoted name as an identifier, not a string', () => {
    const tokens = tokenise('SELECT "gene" FROM v_protein_overview');
    expect(tokens[1]).toMatchObject({ kind: 'word', lower: 'gene' });
  });
});
