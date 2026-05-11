/**
 * Database compatibility shim — auto-detects Bun vs Node.js and
 * uses the appropriate SQLite implementation.
 *
 * - Bun  → bun:sqlite (native, fast)
 * - Node → better-sqlite3 (npm package)
 *
 * The shim presents a better-sqlite3-compatible API:
 *   db = new Database(path, { readonly: true })
 *   stmt = db.prepare(sql)
 *   stmt.get(params) / stmt.all(params) / stmt.run(params)
 *   db.close()
 */

let Database;

// Detect Bun runtime
const isBun = typeof Bun !== 'undefined';

if (isBun) {
  const { Database: BunDatabase } = require('bun:sqlite');

  // Wrapper (composition, not inheritance) to avoid recursive .prepare() / .query()
  Database = function Database(path, opts = {}) {
    const bunOpts = {};
    if (opts.readonly != null) {
      bunOpts.readonly = opts.readonly;
      bunOpts.create = !opts.readonly;
    }
    const _db = new BunDatabase(path, bunOpts);

    return {
      prepare(sql) {
        return _db.query(sql);
      },
      close() {
        return _db.close();
      },
    };
  };
} else {
  Database = require('better-sqlite3');
}

module.exports = Database;
