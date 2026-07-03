// MySQL-compatible adapter that preserves the Supabase-style API used by the app.
const STORAGE_KEY = "manhwapedia:mysql-data";
const SESSION_STORAGE_KEY = "manhwapedia:mysql-session";

type AnyObject = Record<string, any>;

type QueryState = {
  table: string;
  filters: Array<{ column: string; operator: string; value: any }>;
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

type RelationSpec = { name: string; subfields: string[] };

type MysqlLikePool = {
  query: (sql: string, values?: any[]) => Promise<[any[], any]>;
  end: () => Promise<void>;
};

class QueryBuilder {
  private state: QueryState;
  private adapter: MySqlCompatibleAdapter;

  constructor(adapter: MySqlCompatibleAdapter, table: string) {
    this.adapter = adapter;
    this.state = {
      table,
      filters: [],
      select: null,
      orderBy: null,
      limitValue: null,
    };
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
    if (rows.length !== 1) {
      return { data: null, error: new Error("Expected exactly one row") };
    }
    return { data: rows[0], error: null };
  }

  async insert(values: AnyObject | AnyObject[]) {
    return this.adapter.insert(this.state.table, values);
  }

  async update(values: AnyObject) {
    return this.adapter.update(this.state.table, this.state.filters, values);
  }

  async delete() {
    return this.adapter.delete(this.state.table, this.state.filters);
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

class MySqlCompatibleAdapter {
  private store: Record<string, AnyObject[]>;
  private authCallbacks: AuthCallback[] = [];
  private currentSession: AuthSession | null = null;
  private mysqlPool: MysqlLikePool | null = null;

  constructor() {
    this.store = this.loadStore();
    this.currentSession = this.loadSession();
    this.initializeSeedData();
    this.mergeSeedData();
  }

  from(table: string) {
    return new QueryBuilder(this, table);
  }

  get auth() {
    return {
      signUp: async ({ email, password, options }: { email: string; password: string; options?: { data?: AnyObject } }) => {
        if (typeof window !== "undefined") {
          const exists = this.findRows("profiles", [{ column: "email", operator: "=", value: email }]);
          if (exists.length > 0) {
            return { data: null, error: new Error("E-mail already registered") };
          }

          const user = {
            id: this.makeId(),
            email,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            password_hash: this.hashPassword(password),
          };
          await this.insert("users", user);

          const profile = {
            id: user.id,
            email,
            username: options?.data?.username ?? email.split("@")[0],
            display_name: options?.data?.username ?? email.split("@")[0],
            avatar_url: null,
            created_at: user.created_at,
            updated_at: user.updated_at,
          };
          await this.insert("profiles", profile);
          await this.insert("user_roles", { id: this.makeId(), user_id: user.id, role: "user" });

          const session = this.createSession(user);
          this.persistSession(session);
          this.notifyAuthListeners("SIGNED_UP", session);
          return { data: { user }, error: null };
        }

        const session = this.createSession({ id: this.makeId(), email });
        this.persistSession(session);
        this.notifyAuthListeners("SIGNED_UP", session);
        return { data: { user: { id: session.user.id, email } }, error: null };
      },
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        if (typeof window !== "undefined") {
          const [user] = this.findRows("users", [{ column: "email", operator: "=", value: email }]);
          if (!user || user.password_hash !== this.hashPassword(password)) {
            return { data: { session: null }, error: new Error("Invalid credentials") };
          }

          const session = this.createSession(user);
          this.persistSession(session);
          this.notifyAuthListeners("SIGNED_IN", session);
          return { data: { session }, error: null };
        }

        const session = this.createSession({ id: this.makeId(), email });
        this.persistSession(session);
        this.notifyAuthListeners("SIGNED_IN", session);
        return { data: { session }, error: null };
      },
      signOut: async () => {
        this.persistSession(null);
        this.currentSession = null;
        this.notifyAuthListeners("SIGNED_OUT", null);
        return { error: null };
      },
      getSession: async () => ({ data: { session: this.currentSession }, error: null }),
      getClaims: async (token: string) => {
        const session = this.currentSession && this.currentSession.access_token === token ? this.currentSession : null;
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
          access_token: tokens.access_token ?? tokens.token ?? this.makeId(),
          refresh_token: tokens.refresh_token ?? this.makeId(),
          user: tokens.user ?? this.currentSession?.user ?? null,
        } as AuthSession;
        this.persistSession(session);
        this.currentSession = session;
        this.notifyAuthListeners("TOKEN_REFRESHED", session);
        return { data: { session }, error: null };
      },
    };
  }

  async select(state: QueryState) {
    if (await this.ensureMysqlConnection()) {
      return this.selectFromMysql(state);
    }
    const rows = this.findRows(state.table, state.filters);
    const scoped = this.applyOrderAndLimit(rows, state.orderBy, state.limitValue);
    const projected = scoped.map((row) => this.projectRow(state.table, row, state.select));
    return { data: projected, error: null };
  }

  async insert(table: string, values: AnyObject | AnyObject[]) {
    if (await this.ensureMysqlConnection()) {
      return this.insertIntoMysql(table, values);
    }
    const rows = Array.isArray(values) ? values : [values];
    const created = rows.map((row) => {
      const record = { ...row, id: row.id ?? this.makeId(), created_at: row.created_at ?? new Date().toISOString(), updated_at: row.updated_at ?? new Date().toISOString() };
      this.store[table] ??= [];
      this.store[table].push(record);
      return record;
    });
    this.persistStore();
    return { data: Array.isArray(values) ? created : created[0], error: null };
  }

  async update(table: string, filters: Array<{ column: string; operator: string; value: any }>, values: AnyObject) {
    if (await this.ensureMysqlConnection()) {
      const where = this.buildWhere(filters);
      const fields = Object.entries(values).map(([key]) => `\`${key}\` = ?`).join(", ");
      const params = Object.values(values);
      const [result] = await this.mysqlPool!.query(`UPDATE \`${table}\` SET ${fields} ${where.sql}`, [...params, ...where.values]);
      return { data: result, error: null };
    }
    const rows = this.findRows(table, filters);
    const updated = rows.map((row) => ({ ...row, ...values, updated_at: new Date().toISOString() }));
    this.store[table] = (this.store[table] ?? []).map((row) => {
      const match = rows.find((item) => item.id === row.id);
      return match ? updated.find((item) => item.id === row.id)! : row;
    });
    this.persistStore();
    return { data: updated, error: null };
  }

  async delete(table: string, filters: Array<{ column: string; operator: string; value: any }>) {
    if (await this.ensureMysqlConnection()) {
      const where = this.buildWhere(filters);
      const [result] = await this.mysqlPool!.query(`DELETE FROM \`${table}\` ${where.sql}`, where.values);
      return { data: result, error: null };
    }
    const rows = this.findRows(table, filters);
    this.store[table] = (this.store[table] ?? []).filter((row) => !rows.some((item) => item.id === row.id));
    this.persistStore();
    return { data: rows, error: null };
  }

  private async ensureMysqlConnection() {
    if (this.mysqlPool) return true;
    if (typeof window !== "undefined") return false;

    const mysqlUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;
    const host = process.env.MYSQL_HOST;
    const port = Number(process.env.MYSQL_PORT || 3306);
    const database = process.env.MYSQL_DATABASE;
    const user = process.env.MYSQL_USER;
    const password = process.env.MYSQL_PASSWORD;

    if (!mysqlUrl && (!host || !database || !user || !password)) return false;

    try {
      const mysql = await import("mysql2/promise");
      this.mysqlPool = mysql.createPool({
        uri: mysqlUrl,
        host,
        port,
        database,
        user,
        password,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      }) as MysqlLikePool;
      await this.mysqlPool.query("SELECT 1");
      return true;
    } catch (error) {
      console.warn("MySQL unavailable, falling back to in-memory storage", error);
      return false;
    }
  }

  private async selectFromMysql(state: QueryState) {
    const selectColumns = state.select && state.select !== "*" ? state.select : "*";
    const where = this.buildWhere(state.filters);
    const order = state.orderBy ? `ORDER BY \`${state.orderBy.column}\` ${state.orderBy.ascending ? "ASC" : "DESC"}` : "";
    const limit = state.limitValue ? `LIMIT ${state.limitValue}` : "";
    const sql = `SELECT ${selectColumns} FROM \`${state.table}\` ${where.sql} ${order} ${limit}`.trim();
    const [rows] = await this.mysqlPool!.query(sql, where.values);
    const mapped = (rows as AnyObject[]).map((row) => this.projectRow(state.table, row, state.select));
    return { data: mapped, error: null };
  }

  private async insertIntoMysql(table: string, values: AnyObject | AnyObject[]) {
    const rows = Array.isArray(values) ? values : [values];
    const payloads = rows.map((row) => {
      const record = {
        ...row,
        id: row.id ?? this.makeId(),
        created_at: row.created_at ?? new Date().toISOString(),
        updated_at: row.updated_at ?? new Date().toISOString(),
      };
      const columns = Object.keys(record);
      return {
        columns,
        values: Object.values(record),
        record,
      };
    });

    const created = [] as AnyObject[];
    for (const payload of payloads) {
      const placeholders = payload.columns.map(() => "?").join(", ");
      await this.mysqlPool!.query(`INSERT INTO \`${table}\` (\`${payload.columns.join("`, `")}\`) VALUES (${placeholders})`, payload.values);
      created.push(payload.record);
    }
    return { data: Array.isArray(values) ? created : created[0], error: null };
  }

  private buildWhere(filters: Array<{ column: string; operator: string; value: any }>) {
    const clauses = filters.map((filter) => {
      if (filter.operator === "NOT is") {
        return `\`${filter.column}\` IS NOT NULL`;
      }
      return `\`${filter.column}\` ${filter.operator} ?`;
    });
    const values = filters.filter((filter) => filter.operator !== "NOT is").map((filter) => filter.value);
    return {
      sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
      values,
    };
  }

  private findRows(table: string, filters: Array<{ column: string; operator: string; value: any }>) {
    const rows = this.store[table] ?? [];
    return rows.filter((row) => filters.every((filter) => this.matchesFilter(row, filter)));
  }

  private matchesFilter(row: AnyObject, filter: { column: string; operator: string; value: any }) {
    const actual = row[filter.column];
    switch (filter.operator) {
      case "=":
        return actual === filter.value;
      case "!=":
        return actual !== filter.value;
      case "NOT is":
        return actual !== null;
      default:
        return true;
    }
  }

  private applyOrderAndLimit(rows: AnyObject[], orderBy: { column: string; ascending: boolean } | null, limitValue: number | null) {
    const sorted = [...rows];
    if (orderBy) {
      sorted.sort((a, b) => {
        const first = a[orderBy.column];
        const second = b[orderBy.column];
        if (first == null || second == null) return 0;
        if (typeof first === "number" && typeof second === "number") {
          return orderBy.ascending ? first - second : second - first;
        }
        const comparison = String(first).localeCompare(String(second));
        return orderBy.ascending ? comparison : -comparison;
      });
    }
    if (limitValue != null) return sorted.slice(0, limitValue);
    return sorted;
  }

  private projectRow(table: string, row: AnyObject, selectText: string | null) {
    const parsed = this.parseSelect(selectText ?? "*");
    if (parsed.baseColumns.includes("*")) {
      const base: AnyObject = { ...row };
      return this.applyRelations(table, base, parsed.relations);
    }

    const projected: AnyObject = {};
    parsed.baseColumns.forEach((column) => {
      if (column in row) projected[column] = row[column];
    });
    return this.applyRelations(table, projected, parsed.relations);
  }

  private parseSelect(selectText: string) {
    const rawParts = selectText.split(",").map((part) => part.trim()).filter(Boolean);
    const baseColumns: string[] = [];
    const relations: RelationSpec[] = [];

    rawParts.forEach((part) => {
      const relationMatch = part.match(/^([A-Za-z0-9_]+)\((.*)\)$/);
      if (relationMatch) {
        const [, name, inner] = relationMatch;
        const subfields = inner
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .map((item) => item.replace(/\((.*)\)/, ""));
        relations.push({ name, subfields });
        return;
      }
      baseColumns.push(part);
    });

    return { baseColumns, relations };
  }

  private applyRelations(table: string, row: AnyObject, relations: RelationSpec[]) {
    const result = { ...row };

    relations.forEach((relation) => {
      if (table === "wiki_pages" && relation.name === "page_tags") {
        const relatedRows = (this.store.page_tags ?? []).filter((item) => item.page_id === row.id);
        const resolved = relatedRows.map((item) => {
          const payload: AnyObject = { ...item };
          if (relation.subfields.includes("tags")) {
            const tag = (this.store.tags ?? []).find((entry) => entry.id === item.tag_id);
            payload.tags = tag ? { ...tag } : null;
          }
          return payload;
        });
        result.page_tags = resolved;
      }

      if (table === "page_tags" && relation.name === "tags") {
        const tag = (this.store.tags ?? []).find((entry) => entry.id === row.tag_id);
        result.tags = tag ? { ...tag } : null;
      }
    });

    return result;
  }

  private loadStore() {
    if (typeof window === "undefined") {
      return {} as Record<string, AnyObject[]>;
    }

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return {} as Record<string, AnyObject[]>;
      return JSON.parse(raw) as Record<string, AnyObject[]>;
    } catch {
      return {} as Record<string, AnyObject[]>;
    }
  }

  private persistStore() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store));
    } catch {
      // ignore persistence errors
    }
  }

  private loadSession() {
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
      if (session) {
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      } else {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch {
      // ignore persistence errors
    }
  }

  private notifyAuthListeners(event: string, session: AuthSession | null) {
    this.authCallbacks.forEach((callback) => callback(event, session));
  }

  private makeId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private hashPassword(password: string) {
    let hash = 0;
    for (let i = 0; i < password.length; i += 1) {
      hash = (hash * 31 + password.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
  }

  private createSession(user: AnyObject): AuthSession {
    return {
      access_token: this.makeId(),
      refresh_token: this.makeId(),
      user,
    };
  }

  private initializeSeedData() {
    if (Object.keys(this.store).length > 0) return;

    this.store.wiki_pages = [
      {
        id: "70c623b0-1226-4562-908b-f7fc2b1ea31e",
        slug: "jungle-juice",
        title: "Jungle Juice",
        type: "series",
        cover_url: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx128882-UxgmKbYEjuEz.jpg",
        content_md:
          "## Sinopse\n\nJang Suchan é um universitário comum até o dia em que um inseto misterioso invade seu corpo e desperta habilidades sobre-humanas ligadas ao mundo dos insetos. Em vez de virar herói, ele se vê arrastado para uma sociedade secreta de humanos-insetos que sobrevivem escondidos entre a população — cada um marcado pelas características do bicho que os transformou.\n\nPreso entre o medo de perder o controle, o desejo de proteger quem ama e a chance de finalmente escapar do papel de \"esquecível\", Suchan precisa aprender a usar suas asas, garras e instintos antes que caçadores, gangues rivais e organizações ainda mais sombrias o alcancem.\n\n## Temas\n\n- Sobrevivência urbana e identidade\n- Corpo, transformação e monstruosidade\n- Pertencimento e classe social\n- Ação body-horror em ritmo de manhwa moderno\n\n## Curiosidades\n\n- Publicado originalmente na plataforma Naver Webtoon.\n- Faz parte da onda de manhwas de \"ação com sistema\" que ganhou tração global após *Solo Leveling*.\n",
        status: "ongoing",
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        created_by: null,
        updated_by: null,
        parent_slug: null,
        infobox: {
          artist: "Juder",
          author: "Hyeong Eun-Kang / Juder",
          chapters: 150,
          demographic: "Seinen",
          origin: "Coreia do Sul (Manhwa)",
          release_date: "2020",
        },
      },
      {
        id: "3b775974-9587-4da1-a717-8a05adac9247",
        slug: "baskerville-bloodhound",
        title: "Revenge of the Baskerville Bloodhound",
        type: "series",
        cover_url: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx163824-KiablxybJD6i.jpg",
        content_md:
          "## Sinopse\n\nTraído pelo próprio clã e executado sob acusações forjadas, o cavaleiro Bran Baskerville acorda anos antes da tragédia — em um corpo mais jovem, com a memória intacta e uma dívida de sangue ainda por cobrar. Para desmontar a conspiração que destruiu sua casa, ele terá que reconstruir sua reputação como o lendário \"Cão de Caça dos Baskerville\", refinar magias proibidas e infiltrar-se de novo na aristocracia que um dia serviu.\n\nEntre torneios cavaleirescos, intrigas de corte e caçadas em florestas malditas, Bran caminha por uma linha tênue: cada nova aliança pode ser a mesma que o levou ao patíbulo na vida anterior.\n\n## Temas\n\n- Retorno ao passado e livre-arbítrio\n- Vingança fria contra política de corte\n- Cavalaria, honra corrompida e magia proibida\n\n## Curiosidades\n\n- Faz parte do subgênero \"regressor de vingança\", muito popular em manhwas de fantasia.\n- Estrutura episódica: cada arco resolve uma peça da conspiração central.\n",
        status: "ongoing",
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        created_by: null,
        updated_by: null,
        parent_slug: null,
        infobox: {
          artist: "Desconhecido",
          author: "Desconhecido",
          chapters: 80,
          demographic: "Shounen / Seinen",
          origin: "Coreia do Sul (Manhwa)",
          release_date: "2023",
        },
      },
      {
        id: "e90a2f58-8159-45ed-8cf8-a57a13ae8d47",
        slug: "fragrant-flower",
        title: "The Fragrant Flower Blooms With Dignity",
        type: "series",
        cover_url: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx140475-QEGtrmdvbpOv.jpg",
        content_md:
          "## Sinopse\n\nRintarou frequenta a Chidori, escola pública temida pela vizinhança por seus alunos rebeldes. Kaoruko estuda na Kikyou, um colégio feminino de elite bem em frente — separadas por um muro simbólico, as duas escolas evitam qualquer contato. Quando os dois se conhecem por acaso na confeitaria da família de Rintarou, descobrem que os rótulos que cada um carrega dizem muito pouco sobre quem realmente são.\n\n*The Fragrant Flower Blooms With Dignity* é uma comédia romântica delicada sobre preconceito de classe, primeiros afetos e a coragem cotidiana de ser gentil com quem o mundo insiste em julgar mal.\n\n## Temas\n\n- Preconceito e diferenças sociais\n- Primeiro amor adolescente\n- Família, comunidade e vida escolar\n\n## Curiosidades\n\n- Publicado na *Weekly Shounen Magazine*.\n- Recebeu adaptação para anime em 2025.\n",
        status: "ongoing",
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        created_by: null,
        updated_by: null,
        parent_slug: null,
        infobox: {
          artist: "Saka Mikami",
          author: "Saka Mikami",
          chapters: 110,
          demographic: "Shounen / Romance escolar",
          origin: "Japão (Manga)",
          release_date: "2021",
        },
      },
    ];

    this.store.tags = [
      { id: "6a2edd99-1563-4bb9-97eb-4108224eaab4", slug: "action", name: "Ação", kind: "genre" },
      { id: "67cf7eae-d770-4237-a105-35aef113fa51", slug: "drama", name: "Drama", kind: "genre" },
      { id: "74b82a48-f59c-4baf-8728-4cf05b821f66", slug: "supernatural", name: "Sobrenatural", kind: "tag" },
      { id: "9c70b7e1-5819-48fa-a87c-9f610b37f6ec", slug: "seinen", name: "Seinen", kind: "tag" },
      { id: "7ce7b260-63b0-4d23-a7fc-de3d7dd613d5", slug: "fantasy", name: "Fantasia", kind: "genre" },
      { id: "be8266e5-2f01-4b6e-99e8-30477c78341a", slug: "revenge", name: "Vingança", kind: "tag" },
      { id: "dab90a84-0aeb-49dc-a5e5-8c62d812d13b", slug: "shounen", name: "Shounen", kind: "tag" },
      { id: "da86fd01-5952-4f0d-952a-8bc6b0c259ee", slug: "romance", name: "Romance", kind: "genre" },
      { id: "a81632e4-b159-4d7d-88be-03bf1ee7074c", slug: "school-life", name: "Escolar", kind: "genre" },
      { id: "464f21f1-fce4-4145-96a4-4234d0aacedb", slug: "comedy", name: "Comédia", kind: "genre" },
      { id: "39945733-5bad-4b65-bceb-c01db2603052", slug: "slice-of-life", name: "Slice of Life", kind: "tag" },
    ];

    this.store.page_tags = [
      { page_id: "70c623b0-1226-4562-908b-f7fc2b1ea31e", tag_id: "6a2edd99-1563-4bb9-97eb-4108224eaab4" },
      { page_id: "70c623b0-1226-4562-908b-f7fc2b1ea31e", tag_id: "67cf7eae-d770-4237-a105-35aef113fa51" },
      { page_id: "70c623b0-1226-4562-908b-f7fc2b1ea31e", tag_id: "74b82a48-f59c-4baf-8728-4cf05b821f66" },
      { page_id: "70c623b0-1226-4562-908b-f7fc2b1ea31e", tag_id: "9c70b7e1-5819-48fa-a87c-9f610b37f6ec" },
      { page_id: "3b775974-9587-4da1-a717-8a05adac9247", tag_id: "6a2edd99-1563-4bb9-97eb-4108224eaab4" },
      { page_id: "3b775974-9587-4da1-a717-8a05adac9247", tag_id: "7ce7b260-63b0-4d23-a7fc-de3d7dd613d5" },
      { page_id: "3b775974-9587-4da1-a717-8a05adac9247", tag_id: "67cf7eae-d770-4237-a105-35aef113fa51" },
      { page_id: "3b775974-9587-4da1-a717-8a05adac9247", tag_id: "be8266e5-2f01-4b6e-99e8-30477c78341a" },
      { page_id: "3b775974-9587-4da1-a717-8a05adac9247", tag_id: "dab90a84-0aeb-49dc-a5e5-8c62d812d13b" },
      { page_id: "e90a2f58-8159-45ed-8cf8-a57a13ae8d47", tag_id: "da86fd01-5952-4f0d-952a-8bc6b0c259ee" },
      { page_id: "e90a2f58-8159-45ed-8cf8-a57a13ae8d47", tag_id: "a81632e4-b159-4d7d-88be-03bf1ee7074c" },
      { page_id: "e90a2f58-8159-45ed-8cf8-a57a13ae8d47", tag_id: "464f21f1-fce4-4145-96a4-4234d0aacedb" },
      { page_id: "e90a2f58-8159-45ed-8cf8-a57a13ae8d47", tag_id: "67cf7eae-d770-4237-a105-35aef113fa51" },
      { page_id: "e90a2f58-8159-45ed-8cf8-a57a13ae8d47", tag_id: "39945733-5bad-4b65-bceb-c01db2603052" },
    ];

    this.store.user_roles = [];
    this.store.profiles = [];
    this.store.users = [];
    this.store.watchlist = [];
    this.store.reports = [];
    this.store.revisions = [];
    this.store.discussions = [];

    this.persistStore();
  }

  private mergeSeedData() {
    const wikiPages = this.store.wiki_pages ?? [];
    const tags = this.store.tags ?? [];
    const pageTags = this.store.page_tags ?? [];

    const neededPages = [
      {
        id: "70c623b0-1226-4562-908b-f7fc2b1ea31e",
        slug: "jungle-juice",
        title: "Jungle Juice",
        type: "series",
        cover_url: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx128882-UxgmKbYEjuEz.jpg",
        content_md: "## Sinopse\n\nJang Suchan é um universitário comum até o dia em que um inseto misterioso invade seu corpo e desperta habilidades sobre-humanas ligadas ao mundo dos insetos. Em vez de virar herói, ele se vê arrastado para uma sociedade secreta de humanos-insetos que sobrevivem escondidos entre a população — cada um marcado pelas características do bicho que os transformou.\n\nPreso entre o medo de perder o controle, o desejo de proteger quem ama e a chance de finalmente escapar do papel de \"esquecível\", Suchan precisa aprender a usar suas asas, garras e instintos antes que caçadores, gangues rivais e organizações ainda mais sombrias o alcancem.\n\n## Temas\n\n- Sobrevivência urbana e identidade\n- Corpo, transformação e monstruosidade\n- Pertencimento e classe social\n- Ação body-horror em ritmo de manhwa moderno\n\n## Curiosidades\n\n- Publicado originalmente na plataforma Naver Webtoon.\n- Faz parte da onda de manhwas de \"ação com sistema\" que ganhou tração global após *Solo Leveling*.\n",
        status: "ongoing",
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        created_by: null,
        updated_by: null,
        parent_slug: null,
        infobox: {
          artist: "Juder",
          author: "Hyeong Eun-Kang / Juder",
          chapters: 150,
          demographic: "Seinen",
          origin: "Coreia do Sul (Manhwa)",
          release_date: "2020",
        },
      },
      {
        id: "3b775974-9587-4da1-a717-8a05adac9247",
        slug: "baskerville-bloodhound",
        title: "Revenge of the Baskerville Bloodhound",
        type: "series",
        cover_url: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx163824-KiablxybJD6i.jpg",
        content_md: "## Sinopse\n\nTraído pelo próprio clã e executado sob acusações forjadas, o cavaleiro Bran Baskerville acorda anos antes da tragédia — em um corpo mais jovem, com a memória intacta e uma dívida de sangue ainda por cobrar. Para desmontar a conspiração que destruiu sua casa, ele terá que reconstruir sua reputação como o lendário \"Cão de Caça dos Baskerville\", refinar magias proibidas e infiltrar-se de novo na aristocracia que um dia serviu.\n\nEntre torneios cavaleirescos, intrigas de corte e caçadas em florestas malditas, Bran caminha por uma linha tênue: cada nova aliança pode ser a mesma que o levou ao patíbulo na vida anterior.\n\n## Temas\n\n- Retorno ao passado e livre-arbítrio\n- Vingança fria contra política de corte\n- Cavalaria, honra corrompida e magia proibida\n\n## Curiosidades\n\n- Faz parte do subgênero \"regressor de vingança\", muito popular em manhwas de fantasia.\n- Estrutura episódica: cada arco resolve uma peça da conspiração central.\n",
        status: "ongoing",
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        created_by: null,
        updated_by: null,
        parent_slug: null,
        infobox: {
          artist: "Desconhecido",
          author: "Desconhecido",
          chapters: 80,
          demographic: "Shounen / Seinen",
          origin: "Coreia do Sul (Manhwa)",
          release_date: "2023",
        },
      },
      {
        id: "e90a2f58-8159-45ed-8cf8-a57a13ae8d47",
        slug: "fragrant-flower",
        title: "The Fragrant Flower Blooms With Dignity",
        type: "series",
        cover_url: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx140475-QEGtrmdvbpOv.jpg",
        content_md: "## Sinopse\n\nRintarou frequenta a Chidori, escola pública temida pela vizinhança por seus alunos rebeldes. Kaoruko estuda na Kikyou, um colégio feminino de elite bem em frente — separadas por um muro simbólico, as duas escolas evitam qualquer contato. Quando os dois se conhecem por acaso na confeitaria da família de Rintarou, descobrem que os rótulos que cada um carrega dizem muito pouco sobre quem realmente são.\n\n*The Fragrant Flower Blooms With Dignity* é uma comédia romântica delicada sobre preconceito de classe, primeiros afetos e a coragem cotidiana de ser gentil com quem o mundo insiste em julgar mal.\n\n## Temas\n\n- Preconceito e diferenças sociais\n- Primeiro amor adolescente\n- Família, comunidade e vida escolar\n\n## Curiosidades\n\n- Publicado na *Weekly Shounen Magazine*.\n- Recebeu adaptação para anime em 2025.\n",
        status: "ongoing",
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        created_by: null,
        updated_by: null,
        parent_slug: null,
        infobox: {
          artist: "Saka Mikami",
          author: "Saka Mikami",
          chapters: 110,
          demographic: "Shounen / Romance escolar",
          origin: "Japão (Manga)",
          release_date: "2021",
        },
      },
    ];

    const neededTags = [
      { id: "6a2edd99-1563-4bb9-97eb-4108224eaab4", slug: "action", name: "Ação", kind: "genre" },
      { id: "67cf7eae-d770-4237-a105-35aef113fa51", slug: "drama", name: "Drama", kind: "genre" },
      { id: "74b82a48-f59c-4baf-8728-4cf05b821f66", slug: "supernatural", name: "Sobrenatural", kind: "tag" },
      { id: "9c70b7e1-5819-48fa-a87c-9f610b37f6ec", slug: "seinen", name: "Seinen", kind: "tag" },
      { id: "7ce7b260-63b0-4d23-a7fc-de3d7dd613d5", slug: "fantasy", name: "Fantasia", kind: "genre" },
      { id: "be8266e5-2f01-4b6e-99e8-30477c78341a", slug: "revenge", name: "Vingança", kind: "tag" },
      { id: "dab90a84-0aeb-49dc-a5e5-8c62d812d13b", slug: "shounen", name: "Shounen", kind: "tag" },
      { id: "da86fd01-5952-4f0d-952a-8bc6b0c259ee", slug: "romance", name: "Romance", kind: "genre" },
      { id: "a81632e4-b159-4d7d-88be-03bf1ee7074c", slug: "school-life", name: "Escolar", kind: "genre" },
      { id: "464f21f1-fce4-4145-96a4-4234d0aacedb", slug: "comedy", name: "Comédia", kind: "genre" },
      { id: "39945733-5bad-4b65-bceb-c01db2603052", slug: "slice-of-life", name: "Slice of Life", kind: "tag" },
    ];

    const neededPageTags = [
      { page_id: "70c623b0-1226-4562-908b-f7fc2b1ea31e", tag_id: "6a2edd99-1563-4bb9-97eb-4108224eaab4" },
      { page_id: "70c623b0-1226-4562-908b-f7fc2b1ea31e", tag_id: "67cf7eae-d770-4237-a105-35aef113fa51" },
      { page_id: "70c623b0-1226-4562-908b-f7fc2b1ea31e", tag_id: "74b82a48-f59c-4baf-8728-4cf05b821f66" },
      { page_id: "70c623b0-1226-4562-908b-f7fc2b1ea31e", tag_id: "9c70b7e1-5819-48fa-a87c-9f610b37f6ec" },
      { page_id: "3b775974-9587-4da1-a717-8a05adac9247", tag_id: "6a2edd99-1563-4bb9-97eb-4108224eaab4" },
      { page_id: "3b775974-9587-4da1-a717-8a05adac9247", tag_id: "7ce7b260-63b0-4d23-a7fc-de3d7dd613d5" },
      { page_id: "3b775974-9587-4da1-a717-8a05adac9247", tag_id: "67cf7eae-d770-4237-a105-35aef113fa51" },
      { page_id: "3b775974-9587-4da1-a717-8a05adac9247", tag_id: "be8266e5-2f01-4b6e-99e8-30477c78341a" },
      { page_id: "3b775974-9587-4da1-a717-8a05adac9247", tag_id: "dab90a84-0aeb-49dc-a5e5-8c62d812d13b" },
      { page_id: "e90a2f58-8159-45ed-8cf8-a57a13ae8d47", tag_id: "da86fd01-5952-4f0d-952a-8bc6b0c259ee" },
      { page_id: "e90a2f58-8159-45ed-8cf8-a57a13ae8d47", tag_id: "a81632e4-b159-4d7d-88be-03bf1ee7074c" },
      { page_id: "e90a2f58-8159-45ed-8cf8-a57a13ae8d47", tag_id: "464f21f1-fce4-4145-96a4-4234d0aacedb" },
      { page_id: "e90a2f58-8159-45ed-8cf8-a57a13ae8d47", tag_id: "67cf7eae-d770-4237-a105-35aef113fa51" },
      { page_id: "e90a2f58-8159-45ed-8cf8-a57a13ae8d47", tag_id: "39945733-5bad-4b65-bceb-c01db2603052" },
    ];

    neededPages.forEach((page) => {
      if (!wikiPages.some((existing: AnyObject) => existing.id === page.id || existing.slug === page.slug)) {
        wikiPages.push(page);
      }
    });

    neededTags.forEach((tag) => {
      if (!tags.some((existing: AnyObject) => existing.id === tag.id || existing.slug === tag.slug)) {
        tags.push(tag);
      }
    });

    neededPageTags.forEach((relation) => {
      if (!pageTags.some((existing: AnyObject) => existing.page_id === relation.page_id && existing.tag_id === relation.tag_id)) {
        pageTags.push(relation);
      }
    });

    this.store.wiki_pages = wikiPages;
    this.store.tags = tags;
    this.store.page_tags = pageTags;
    this.persistStore();
  }
}

const adapter = new MySqlCompatibleAdapter();
export const supabase = {
  from: (table: string) => adapter.from(table),
  auth: adapter.auth,
};

