/**
 * Type declarations for lib/database.js
 */
declare class Database {
  constructor(path: string, opts?: { readonly?: boolean });
  prepare(sql: string): {
    get(...params: any[]): any;
    all(...params: any[]): any[];
    run(...params: any[]): any;
  };
  close(): void;
}

export = Database;
