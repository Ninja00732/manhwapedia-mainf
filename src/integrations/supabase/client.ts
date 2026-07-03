// Cliente compatível com a API do Supabase, mas que fala com MySQL a sério.
//
// Diferente da versão anterior, TODAS as operações (select/insert/update/delete
// e autenticação) passam por "server functions" do TanStack Start. Isto garante
// que mesmo quando o código corre no browser, o pedido é sempre executado no
// servidor Node — onde a ligação MySQL (mysql2) realmente existe — em vez de
// cair silenciosamente para dados falsos guardados no localStorage.
import { createServerFn } from "@tanstack/react-start";

const SESSION_STORAGE_KEY = "manhwapedia:mysql-session";

type AnyObject = Record<string, any>;

type FilterSpec = { column: string; operator: string; value: any };

type QueryState = {
  table: string;
  filters: FilterSpec[];
  select: string | null;
  orderBy: { column: string; ascending: boolean } | null;
  limitValue: number | null;
};

type AuthSession = {
  access_token: string;
  refresh_token: string;
  user: AnyObject;
};

type AuthCallback = (event: string, session: AuthSession | null) => void;

type RelationSpec = {
  aliasOut: string;
  targetTable: string;
  localColumn: string;
  direction: "forward" | "reverse";
  subfields: string[];
  nested: RelationSpec[];
};

// ------------------------------------------------------------------
// Parsing do texto de "select" no estilo Supabase/Postgrest, incluindo
// relações embutidas: "table(cols)", "table!fkColumn(cols)", "alias:fkColumn(cols)"
// ------------------------------------------------------------------

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

// Mapa de "convenções" desta base de dados: como encontrar a coluna de FK
// quando a query não a indica explicitamente (sem "!coluna" nem "alias:coluna").
function guessRelation(currentTable: string, targetTable: string): { localColumn: string; direction: "forward" | "reverse" } {
  if (currentTable === "wiki_pages" && targetTable === "page_tags") {
    return { localColumn: "page_id", direction: "reverse" };
  }
  if (targetTable === "wiki_pages") return { localColumn: "page_id", direction: "forward" };
  if (targetTable === "tags") return { localColumn: "tag_id", direction: "forward" };
  if (targetTable === "profiles") return { localColumn: "user_id", direction: "forward" };
  return { localColumn: `${targetTable.replace(/s$/, "")}_id`, direction: "forward" };
}

function parseRelation(part: string, currentTable: string): RelationSpec | null {
  const match = part.match(/^(?:([A-Za-z0-9_]+):)?([A-Za-z0-9_]+)(?:!([A-Za-z0-9_]+))?\((.*)\)$/s);
  if (!match) return null;
  const [, aliasPart, namePart, hintPart, inner] = match;

  let targetTable: string;
  let localColumn: string;
  let direction: "forward" | "reverse";
  let aliasOut: string;

  if (aliasPart) {
    // "profiles:editor_id(...)" => alias "profiles" É a tabela alvo,
    // "editor_id" é a coluna local que aponta para ela.
    targetTable = aliasPart;
    localColumn = namePart;
    direction = "forward";
    aliasOut = aliasPart;
  } else {
    targetTable = namePart;
    aliasOut = namePart;
    if (hintPart && hintPart !== "inner") {
      localColumn = hintPart;
      direction = "forward";
    } else {
      const guess = guessRelation(currentTable, targetTable);
      localColumn = guess.localColumn;
      direction = guess.direction;
    }
  }

  const innerParts = splitTopLevel(inner);
  const subfields: string[] = [];
  const nested: RelationSpec[] = [];
  innerParts.forEach((ip) => {
    const nestedRel = parseRelation(ip, targetTable);
    if (nestedRel) nested.push(nestedRel);
    else subfields.push(ip);
  });

  return { aliasOut, targetTable, localColumn, direction, subfields, nested };
}

function parseSelect(selectText: string, currentTable: string) {
  const rawParts = splitTopLevel(selectText);
  const baseColumns: string[] = [];
  const relations: RelationSpec[] = [];

  rawParts.forEach((part) => {
    const relation = parseRelation(part, currentTable);
    if (relation) relations.push(relation);
    else baseColumns.push(part);
  });

  return { baseColumns, relations };
}

// ------------------------------------------------------------------
// QueryBuilder — mantém a mesma API fluente usada em todo o projeto
// (.select().eq().order().limit()...), mas delega a execução real
// para as server functions abaixo.
// ------------------------------------------------------------------

class QueryBuilder {
  private state: QueryState;
  private adapter: MySqlCompatibleAdapter;

  constructor(adapter: MySqlCompatibleAdapter, table: string) {
    this.adapter = adapter;
    this.state = { table, filters: [], select: null, orderBy: null, limitValue: null };
  }

  select(columns: string) {
    this.state.select = columns;
    return this;
  }

  eq(column: string, value: any) {
    this.state.filters.push({ column, operator: "=", value });
    return this;
  }

  neq(column: string, value: any) {
    this.state.filters.push({ column, operator: "!=", value });
    return this;
  }

  not(column: string, operator: string, value: any) {
    this.state.filters.push({ column, operator: `NOT ${operator}`.trim(), value });
    return this;
  }

  ilike(column: string, pattern: string) {
    this.state.filters.push({ column, operator: "LIKE", value: pattern });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.state.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(value: number) {
    this.state.limitValue = value;
    return this;
  }

  async maybeSingle() {
    const { data, error } = await this.execute();
    if (error) return { data: null, error };
    return { data: Array.isArray(data) ? data[0] ?? null : data, error: null };
  }

  async single() {
    const { data, error } = await this.execute();
    if (error) return { data: null, error };
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length !== 1) return { data: null, error: new Error("Expected exactly one row") };
    return { data: rows[0], error: null };
  }

  async insert(values: AnyObject | AnyObject[]) {
    return this.adapter.insert(this.state.table, values);
  }

  update(values: AnyObject) {
    return new MutationBuilder(this.adapter, "update", this.state.table, [...this.state.filters], values);
  }

  delete() {
    return new MutationBuilder(this.adapter, "delete", this.state.table, [...this.state.filters], null);
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null) {
    return this.execute().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null) {
    return this.execute().finally(onfinally);
  }

  private async execute() {
    return this.adapter.select(this.state);
  }
}

// Suporta o padrão real do Supabase: .update(valores).eq(...) e
// .delete().eq(...) — os filtros vêm DEPOIS da chamada a update/delete.
class MutationBuilder {
  private filters: FilterSpec[];

  constructor(
    private adapter: MySqlCompatibleAdapter,
    private op: "update" | "delete",
    private table: string,
    initialFilters: FilterSpec[],
    private values: AnyObject | null,
  ) {
    this.filters = initialFilters;
  }

  eq(column: string, value: any) {
    this.filters.push({ column, operator: "=", value });
    return this;
  }

  neq(column: string, value: any) {
    this.filters.push({ column, operator: "!=", value });
    return this;
  }

  not(column: string, operator: string, value: any) {
    this.filters.push({ column, operator: `NOT ${operator}`.trim(), value });
    return this;
  }

  private execute() {
    if (this.op === "update") return this.adapter.update(this.table, this.filters, this.values!);
    return this.adapter.delete(this.table, this.filters);
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null) {
    return this.execute().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null) {
    return this.execute().finally(onfinally);
  }
}

// ------------------------------------------------------------------
// Server functions — o ÚNICO sítio onde "mysql2" é usado. Corre sempre
// no servidor Node, nunca no bundle do browser.
// ------------------------------------------------------------------

type MysqlLikePool = {
  query: (sql: string, values?: any[]) => Promise<[any[], any]>;
};

let poolPromise: Promise<MysqlLikePool> | null = null;

async function getPool(): Promise<MysqlLikePool> {
  if (poolPromise) return poolPromise;

  poolPromise = (async () => {
    const mysqlUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;
    const host = process.env.MYSQL_HOST;
    const port = Number(process.env.MYSQL_PORT || 3306);
    const database = process.env.MYSQL_DATABASE;
    const user = process.env.MYSQL_USER;
    const password = process.env.MYSQL_PASSWORD;

    if (!mysqlUrl && (!host || !database || !user)) {
      throw new Error(
        "Ligação MySQL não configurada. Define DATABASE_URL (ex: mysql://root:@localhost:3306/manhwapedia) no .env, ou MYSQL_HOST/MYSQL_DATABASE/MYSQL_USER/MYSQL_PASSWORD.",
      );
    }

    const mysql = await import("mysql2/promise");
    const pool = mysql.createPool(
      mysqlUrl
        ? { uri: mysqlUrl, waitForConnections: true, connectionLimit: 10, queueLimit: 0 }
        : { host, port, database, user, password, waitForConnections: true, connectionLimit: 10, queueLimit: 0 },
    ) as unknown as MysqlLikePool;

    // valida a ligação cedo, com um erro claro em vez de falhar mais tarde
    await pool.query("SELECT 1");
    return pool;
  })();

  return poolPromise;
}

function jsonSafe(value: any) {
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    return JSON.stringify(value);
  }
  return value;
}

function buildWhere(filters: FilterSpec[]) {
  const clauses = filters.map((filter) => {
    if (filter.operator === "NOT is") return `\`${filter.column}\` IS NOT NULL`;
    return `\`${filter.column}\` ${filter.operator} ?`;
  });
  const values = filters.filter((filter) => filter.operator !== "NOT is").map((filter) => filter.value);
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

async function resolveRelations(pool: MysqlLikePool, currentTable: string, rows: AnyObject[], relations: RelationSpec[]) {
  if (rows.length === 0 || relations.length === 0) return;

  for (const rel of relations) {
    if (rel.direction === "forward") {
      const ids = [...new Set(rows.map((r) => r[rel.localColumn]).filter((v) => v !== null && v !== undefined))];
      if (ids.length === 0) {
        rows.forEach((r) => (r[rel.aliasOut] = null));
        continue;
      }
      const placeholders = ids.map(() => "?").join(",");
      const [relRows] = await pool.query(`SELECT * FROM \`${rel.targetTable}\` WHERE \`id\` IN (${placeholders})`, ids);
      if (rel.nested.length) await resolveRelations(pool, rel.targetTable, relRows as AnyObject[], rel.nested);
      const byId = new Map((relRows as AnyObject[]).map((r) => [r.id, projectFields(r, rel.subfields)]));
      rows.forEach((r) => {
        r[rel.aliasOut] = byId.get(r[rel.localColumn]) ?? null;
      });
    } else {
      const parentIds = [...new Set(rows.map((r) => r.id).filter((v) => v !== null && v !== undefined))];
      if (parentIds.length === 0) {
        rows.forEach((r) => (r[rel.aliasOut] = []));
        continue;
      }
      const placeholders = parentIds.map(() => "?").join(",");
      const [childRows] = await pool.query(`SELECT * FROM \`${rel.targetTable}\` WHERE \`${rel.localColumn}\` IN (${placeholders})`, parentIds);
      if (rel.nested.length) await resolveRelations(pool, rel.targetTable, childRows as AnyObject[], rel.nested);
      const grouped = new Map<any, AnyObject[]>();
      (childRows as AnyObject[]).forEach((cr) => {
        const key = cr[rel.localColumn];
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(projectFields(cr, rel.subfields));
      });
      rows.forEach((r) => {
        r[rel.aliasOut] = grouped.get(r.id) ?? [];
      });
    }
  }
}

function projectFields(row: AnyObject, subfields: string[]) {
  if (subfields.length === 0) return row; // sem sub-colunas pedidas -> devolve tudo (inclui relações já resolvidas)
  const out: AnyObject = {};
  subfields.forEach((f) => {
    if (f in row) out[f] = row[f];
  });
  // preserva quaisquer relações aninhadas já resolvidas (alias não estava nos subfields textuais)
  Object.keys(row).forEach((key) => {
    if (Array.isArray(row[key]) || (row[key] && typeof row[key] === "object" && !(row[key] instanceof Date))) {
      if (!(key in out) && key !== "infobox") out[key] = row[key];
    }
  });
  return out;
}

function projectRow(row: AnyObject, baseColumns: string[]) {
  if (baseColumns.length === 0 || baseColumns.includes("*")) return { ...row };
  const projected: AnyObject = {};
  baseColumns.forEach((column) => {
    if (column in row) projected[column] = row[column];
  });
  // mantém as relações já anexadas ao objeto (não fazem parte de baseColumns)
  Object.keys(row).forEach((key) => {
    if (!(key in projected) && (Array.isArray(row[key]) || (row[key] && typeof row[key] === "object" && key !== "infobox"))) {
      // heurística: campos de relação foram adicionados por resolveRelations
    }
  });
  return projected;
}

type SelectPayload = QueryState;

const dbSelect = createServerFn({ method: "POST" })
  .validator((data: SelectPayload) => data)
  .handler(async ({ data }) => {
    const pool = await getPool();
    const where = buildWhere(data.filters);
    const order = data.orderBy ? `ORDER BY \`${data.orderBy.column}\` ${data.orderBy.ascending ? "ASC" : "DESC"}` : "";
    const limit = data.limitValue ? `LIMIT ${data.limitValue}` : "";
    const sql = `SELECT * FROM \`${data.table}\` ${where.sql} ${order} ${limit}`.trim();
    const [rows] = await pool.query(sql, where.values);

    const { baseColumns, relations } = parseSelect(data.select ?? "*", data.table);
    if (relations.length) await resolveRelations(pool, data.table, rows as AnyObject[], relations);

    const projected = (rows as AnyObject[]).map((row) => {
      const kept = projectRow(row, baseColumns);
      relations.forEach((rel) => {
        kept[rel.aliasOut] = row[rel.aliasOut];
      });
      return kept;
    });

    return projected;
  });

type InsertPayload = { table: string; rows: AnyObject[] };

const dbInsert = createServerFn({ method: "POST" })
  .validator((data: InsertPayload) => data)
  .handler(async ({ data }) => {
    const pool = await getPool();
    const created: AnyObject[] = [];
    for (const row of data.rows) {
      const record: AnyObject = {
        ...row,
        id: row.id ?? crypto.randomUUID(),
        created_at: row.created_at ?? new Date(),
        updated_at: row.updated_at ?? new Date(),
      };
      const columns = Object.keys(record);
      const placeholders = columns.map(() => "?").join(", ");
      const values = columns.map((c) => jsonSafe(record[c]));
      await pool.query(`INSERT INTO \`${data.table}\` (\`${columns.join("`, `")}\`) VALUES (${placeholders})`, values);
      created.push(record);
    }
    return created;
  });

type UpdatePayload = { table: string; filters: FilterSpec[]; values: AnyObject };

const dbUpdate = createServerFn({ method: "POST" })
  .validator((data: UpdatePayload) => data)
  .handler(async ({ data }) => {
    const pool = await getPool();
    const where = buildWhere(data.filters);
    const entries = Object.entries({ ...data.values, updated_at: data.values.updated_at ?? new Date() });
    const fields = entries.map(([key]) => `\`${key}\` = ?`).join(", ");
    const params = entries.map(([, value]) => jsonSafe(value));
    await pool.query(`UPDATE \`${data.table}\` SET ${fields} ${where.sql}`, [...params, ...where.values]);
    return { affected: true };
  });

type DeletePayload = { table: string; filters: FilterSpec[] };

const dbDelete = createServerFn({ method: "POST" })
  .validator((data: DeletePayload) => data)
  .handler(async ({ data }) => {
    const pool = await getPool();
    const where = buildWhere(data.filters);
    await pool.query(`DELETE FROM \`${data.table}\` ${where.sql}`, where.values);
    return { affected: true };
  });

function simpleHash(password: string) {
  let hash = 0;
  for (let i = 0; i < password.length; i += 1) hash = (hash * 31 + password.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

type SignUpPayload = { email: string; password: string; username?: string };

const dbAuthSignUp = createServerFn({ method: "POST" })
  .validator((data: SignUpPayload) => data)
  .handler(async ({ data }) => {
    const pool = await getPool();
    const [existing] = await pool.query("SELECT id FROM `users` WHERE `email` = ?", [data.email]);
    if ((existing as AnyObject[]).length > 0) {
      return { error: "E-mail já registado" };
    }

    const id = crypto.randomUUID();
    const now = new Date();
    const username = data.username ?? data.email.split("@")[0];

    await pool.query("INSERT INTO `users` (`id`,`email`,`password_hash`,`created_at`) VALUES (?,?,?,?)", [
      id, data.email, simpleHash(data.password), now,
    ]);
    await pool.query(
      "INSERT INTO `profiles` (`id`,`username`,`display_name`,`created_at`) VALUES (?,?,?,?)",
      [id, username, username, now],
    );
    await pool.query("INSERT INTO `user_roles` (`id`,`user_id`,`role`) VALUES (?,?,?)", [crypto.randomUUID(), id, "user"]);

    return { user: { id, email: data.email } };
  });

type SignInPayload = { email: string; password: string };

const dbAuthSignIn = createServerFn({ method: "POST" })
  .validator((data: SignInPayload) => data)
  .handler(async ({ data }) => {
    const pool = await getPool();
    const [rows] = await pool.query("SELECT id, email, password_hash FROM `users` WHERE `email` = ?", [data.email]);
    const user = (rows as AnyObject[])[0];
    if (!user || user.password_hash !== simpleHash(data.password)) {
      return { error: "Credenciais inválidas" };
    }
    return { user: { id: user.id, email: user.email } };
  });

// ------------------------------------------------------------------
// Adapter — expõe a mesma API do cliente Supabase (from/auth) usada
// em todo o resto do projeto.
// ------------------------------------------------------------------

class MySqlCompatibleAdapter {
  private authCallbacks: AuthCallback[] = [];
  private currentSession: AuthSession | null = null;

  constructor() {
    this.currentSession = this.loadSession();
  }

  from(table: string) {
    return new QueryBuilder(this, table);
  }

  async select(state: QueryState) {
    try {
      const data = await dbSelect({ data: state });
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  async insert(table: string, values: AnyObject | AnyObject[]) {
    const rows = Array.isArray(values) ? values : [values];
    try {
      const created = await dbInsert({ data: { table, rows } });
      return { data: Array.isArray(values) ? created : created[0], error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  async update(table: string, filters: FilterSpec[], values: AnyObject) {
    try {
      await dbUpdate({ data: { table, filters, values } });
      return { data: values, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  async delete(table: string, filters: FilterSpec[]) {
    try {
      await dbDelete({ data: { table, filters } });
      return { data: null, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  get auth() {
    return {
      signUp: async ({ email, password, options }: { email: string; password: string; options?: { data?: AnyObject } }) => {
        const result = await dbAuthSignUp({ data: { email, password, username: options?.data?.username } });
        if ("error" in result) return { data: null, error: new Error(result.error) };
        const session = this.createSession(result.user);
        this.persistSession(session);
        this.notifyAuthListeners("SIGNED_UP", session);
        return { data: { user: result.user }, error: null };
      },
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        const result = await dbAuthSignIn({ data: { email, password } });
        if ("error" in result) return { data: { session: null }, error: new Error(result.error) };
        const session = this.createSession(result.user);
        this.persistSession(session);
        this.notifyAuthListeners("SIGNED_IN", session);
        return { data: { session }, error: null };
      },
      signOut: async () => {
        this.persistSession(null);
        this.notifyAuthListeners("SIGNED_OUT", null);
        return { error: null };
      },
      getSession: async () => ({ data: { session: this.currentSession }, error: null }),
      getClaims: async (token: string) => {
        const session = this.currentSession?.access_token === token ? this.currentSession : null;
        return { data: { claims: session ? { sub: session.user.id, role: "user" } : {} }, error: null };
      },
      onAuthStateChange: (callback: AuthCallback) => {
        this.authCallbacks.push(callback);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                this.authCallbacks = this.authCallbacks.filter((item) => item !== callback);
              },
            },
          },
          error: null,
        };
      },
      setSession: async (tokens: AnyObject) => {
        const session = {
          access_token: tokens.access_token ?? tokens.token ?? crypto.randomUUID(),
          refresh_token: tokens.refresh_token ?? crypto.randomUUID(),
          user: tokens.user ?? this.currentSession?.user ?? null,
        } as AuthSession;
        this.persistSession(session);
        this.notifyAuthListeners("TOKEN_REFRESHED", session);
        return { data: { session }, error: null };
      },
    };
  }

  private createSession(user: AnyObject): AuthSession {
    return { access_token: crypto.randomUUID(), refresh_token: crypto.randomUUID(), user };
  }

  private loadSession(): AuthSession | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as AuthSession) : null;
    } catch {
      return null;
    }
  }

  private persistSession(session: AuthSession | null) {
    this.currentSession = session;
    if (typeof window === "undefined") return;
    try {
      if (session) window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      else window.localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignora erros de persistência
    }
  }

  private notifyAuthListeners(event: string, session: AuthSession | null) {
    this.authCallbacks.forEach((callback) => callback(event, session));
  }
}

const adapter = new MySqlCompatibleAdapter();
export const supabase = {
  from: (table: string) => adapter.from(table),
  auth: adapter.auth,
};
