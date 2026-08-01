function clone(value) {
  return value === null || value === undefined
    ? value
    : structuredClone(value);
}

function compactSql(sql) {
  return String(sql).trim().replace(/\s+/g, " ");
}

function parseJsonParameter(value) {
  return typeof value === "string" ? JSON.parse(value) : clone(value);
}

class TransactionalFakeClient {
  constructor(pool, id) {
    this.pool = pool;
    this.id = id;
    this.inTransaction = false;
    this.locked = false;
    this.loadedState = false;
    this.workingState = null;
    this.stateDirty = false;
    this.released = false;
  }

  async query(sql, params = []) {
    if (this.released) throw new Error("Query used a released fake client.");
    const text = compactSql(sql);
    this.pool.record("query", {
      clientId: this.id,
      inTransaction: this.inTransaction,
      params: clone(params),
      sql: text,
    });
    this.pool.throwInjectedFailure(text);

    if (text === "BEGIN") {
      if (this.inTransaction) throw new Error("Transaction already started.");
      this.inTransaction = true;
      return { rowCount: null, rows: [] };
    }
    if (
      text.startsWith("SET LOCAL lock_timeout = ") ||
      text.startsWith("SET LOCAL statement_timeout = ")
    ) {
      this.requireTransaction();
      return { rowCount: null, rows: [] };
    }
    if (text === "COMMIT") {
      this.requireTransaction();
      if (this.stateDirty) this.pool.state = clone(this.workingState);
      this.inTransaction = false;
      this.pool.unlock(this);
      return { rowCount: null, rows: [] };
    }
    if (text === "ROLLBACK") {
      this.requireTransaction();
      this.inTransaction = false;
      this.pool.unlock(this);
      return { rowCount: null, rows: [] };
    }
    if (text.startsWith("INSERT INTO baynat_state ")) {
      this.requireTransaction();
      await this.pool.lock(this);
      if (!this.loadedState) {
        const inserted = this.pool.state === null;
        this.workingState = inserted
          ? parseJsonParameter(params[1])
          : clone(this.pool.state);
        this.loadedState = true;
        this.stateDirty = inserted;
        return { rowCount: inserted ? 1 : 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }
    if (
      text.startsWith("SELECT state FROM baynat_state ") &&
      text.endsWith("FOR UPDATE")
    ) {
      this.requireTransaction();
      await this.pool.lock(this);
      if (!this.loadedState) {
        this.workingState = clone(this.pool.state);
        this.loadedState = true;
      }
      return {
        rowCount: this.workingState === null ? 0 : 1,
        rows:
          this.workingState === null
            ? []
            : [{ state: clone(this.workingState) }],
      };
    }
    if (text.startsWith("UPDATE baynat_state ")) {
      this.requireTransaction();
      if (!this.locked) {
        throw new Error("State UPDATE executed without SELECT ... FOR UPDATE.");
      }
      this.workingState = parseJsonParameter(params[1]);
      this.loadedState = true;
      this.stateDirty = true;
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unsupported fake client query: ${text}`);
  }

  requireTransaction() {
    if (!this.inTransaction) {
      throw new Error("Query must execute inside a transaction.");
    }
  }

  release() {
    if (this.released) throw new Error("Fake client released twice.");
    this.released = true;
    if (this.locked) this.pool.unlock(this);
    this.pool.record("release", { clientId: this.id });
  }
}

export class TransactionalFakePool {
  constructor({ now = Date.now, state = null } = {}) {
    this.now = now;
    this.state = clone(state);
    this.proofs = new Map();
    this.events = [];
    this.failures = [];
    this.lockOwner = null;
    this.lockWaiters = [];
    this.nextClientId = 1;
  }

  record(type, details = {}) {
    this.events.push({ type, ...details });
  }

  async connect() {
    const client = new TransactionalFakeClient(this, this.nextClientId++);
    this.record("connect", { clientId: client.id });
    return client;
  }

  async query(sql, params = []) {
    const text = compactSql(sql);
    this.record("pool-query", {
      clientId: null,
      inTransaction: false,
      params: clone(params),
      sql: text,
    });
    this.throwInjectedFailure(text);
    if (
      text ===
      "SELECT state FROM baynat_state WHERE singleton_id = $1"
    ) {
      return {
        rowCount: this.state === null ? 0 : 1,
        rows: this.state === null ? [] : [{ state: clone(this.state) }],
      };
    }
    if (
      text.startsWith("WITH expired AS ") &&
      text.includes("INSERT INTO baynat_consumed_proofs") &&
      text.includes("ON CONFLICT (proof_hash) DO NOTHING")
    ) {
      const now = this.now();
      for (const [proofHash, expiresAt] of this.proofs) {
        if (expiresAt <= now) this.proofs.delete(proofHash);
      }
      const [proofHash, expiryValue] = params;
      if (this.proofs.has(proofHash)) return { rowCount: 0, rows: [] };
      this.proofs.set(proofHash, new Date(expiryValue).getTime());
      return { rowCount: 1, rows: [{ proof_hash: proofHash }] };
    }
    throw new Error(`Unsupported fake pool query: ${text}`);
  }

  async end() {
    this.record("end");
  }

  async lock(client) {
    if (this.lockOwner === client) return;
    if (this.lockOwner === null) {
      this.lockOwner = client;
      client.locked = true;
      this.record("lock", { clientId: client.id });
      return;
    }
    await new Promise((resolve) => this.lockWaiters.push(resolve));
    return this.lock(client);
  }

  unlock(client) {
    if (this.lockOwner !== client) return;
    this.lockOwner = null;
    client.locked = false;
    this.record("unlock", { clientId: client.id });
    this.lockWaiters.shift()?.();
  }

  failNext(pattern, error = new Error("Injected database failure.")) {
    this.failures.push({ pattern, error });
  }

  throwInjectedFailure(sql) {
    const index = this.failures.findIndex(({ pattern }) =>
      typeof pattern === "string" ? sql.includes(pattern) : pattern.test(sql)
    );
    if (index === -1) return;
    const [{ error }] = this.failures.splice(index, 1);
    throw error;
  }
}

export function sqlEvents(pool, clientId) {
  return pool.events
    .filter(
      (event) =>
        event.type === "query" &&
        (clientId === undefined || event.clientId === clientId)
    )
    .map((event) => event.sql);
}
