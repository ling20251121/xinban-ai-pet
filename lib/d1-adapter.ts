import type {
  DatabaseResult,
  DatabaseStatement,
  SystemDatabase,
} from "@/lib/database-types";

class D1StatementAdapter implements DatabaseStatement {
  constructor(readonly statement: D1PreparedStatement) {}

  bind(...values: unknown[]): DatabaseStatement {
    return new D1StatementAdapter(this.statement.bind(...values));
  }

  first<TRow>(): Promise<TRow | null> {
    return this.statement.first<TRow>();
  }

  async all<TRow>(): Promise<DatabaseResult<TRow>> {
    return (await this.statement.all<TRow>()) as DatabaseResult<TRow>;
  }

  async run(): Promise<DatabaseResult> {
    return (await this.statement.run()) as DatabaseResult;
  }
}

export class D1SystemDatabase implements SystemDatabase {
  readonly dialect = "d1" as const;

  constructor(private readonly database: D1Database) {}

  prepare(sql: string): DatabaseStatement {
    return new D1StatementAdapter(this.database.prepare(sql));
  }

  async batch(statements: DatabaseStatement[]): Promise<DatabaseResult[]> {
    const prepared = statements.map((statement) => {
      if (!(statement instanceof D1StatementAdapter)) {
        throw new TypeError("Cannot mix database adapters in one batch.");
      }
      return statement.statement;
    });
    return (await this.database.batch(prepared)) as DatabaseResult[];
  }
}
