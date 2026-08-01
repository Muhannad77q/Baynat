import {
  HttpError,
  createInitialData,
  validateStoredData,
} from "../server.js";

const STATE_ROW_ID = 1;
const LOCK_TIMEOUT_MS = 3_000;
const STATEMENT_TIMEOUT_MS = 8_000;

export class SetupKeyConfigurationError extends Error {
  constructor(
    message = "BAYNAT_SETUP_KEY is required until the first supervisor is configured."
  ) {
    super(message);
    this.name = "SetupKeyConfigurationError";
  }
}

export class DatabaseUnavailableError extends HttpError {
  constructor(cause) {
    super(
      503,
      "تعذّر الوصول إلى قاعدة بيانات بَيّنات. حاول مرة أخرى بعد قليل.",
      "DATABASE_UNAVAILABLE"
    );
    this.name = "DatabaseUnavailableError";
    this.cause = cause;
  }
}

export class DatabaseBusyError extends HttpError {
  constructor(cause) {
    super(
      503,
      "قاعدة بيانات بَيّنات مشغولة الآن. حاول مرة أخرى بعد قليل.",
      "DATABASE_BUSY"
    );
    this.name = "DatabaseBusyError";
    this.cause = cause;
  }
}

export class DatabaseConfigurationError extends HttpError {
  constructor(cause) {
    super(
      500,
      "قاعدة بيانات بَيّنات غير مهيأة. تحقّق من ربط Database وتطبيق الترحيلات.",
      "DATABASE_CONFIGURATION_ERROR"
    );
    this.name = "DatabaseConfigurationError";
    this.cause = cause;
  }
}

export class DatabaseStateError extends HttpError {
  constructor(cause) {
    super(
      500,
      "حالة بَيّنات المحفوظة غير صالحة. أوقفنا الكتابة لحماية البيانات.",
      "DATABASE_STATE_INVALID"
    );
    this.name = "DatabaseStateError";
    this.cause = cause;
  }
}

function readStateValue(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return structuredClone(parsed);
  } catch (error) {
    throw new DatabaseStateError(error);
  }
}

function stateFromResult(result) {
  if (!result?.rows?.length) {
    throw new DatabaseStateError(
      new Error("The singleton Baynat state row is missing.")
    );
  }
  return readStateValue(result.rows[0].state);
}

function validateState(value, setupKey) {
  try {
    return validateStoredData(readStateValue(value), setupKey);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new DatabaseStateError(error);
  }
}

async function rollback(client) {
  try {
    await client.query("ROLLBACK");
    return null;
  } catch (error) {
    return error;
  }
}

function asDatabaseError(error) {
  if (
    error instanceof HttpError ||
    error instanceof SetupKeyConfigurationError
  ) {
    return error;
  }
  if (error?.code === "42P01") {
    return new DatabaseConfigurationError(error);
  }
  if (error?.code === "55P03" || error?.code === "57014") {
    return new DatabaseBusyError(error);
  }
  return new DatabaseUnavailableError(error);
}

async function configureTransaction(client) {
  await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
  await client.query(
    `SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`
  );
}

export class NetlifyDatabaseStore {
  constructor({ database, setupKey = "" } = {}) {
    if (
      !database?.pool ||
      typeof database.pool.connect !== "function" ||
      typeof database.pool.query !== "function"
    ) {
      throw new TypeError("A Netlify Database client with a pool is required.");
    }
    this.database = database;
    this.pool = database.pool;
    this.setupKey = String(setupKey || "");
    this.data = null;
  }

  async init() {
    try {
      const selected = await this.pool.query(
        `SELECT state
           FROM baynat_state
          WHERE singleton_id = $1`,
        [STATE_ROW_ID]
      );
      if (selected.rows.length) {
        const validated = validateState(
          selected.rows[0].state,
          this.setupKey
        );
        if (validated.data.supervisors.length === 0 && !this.setupKey) {
          throw new SetupKeyConfigurationError();
        }
        if (!validated.migrated) {
          this.data = validated.data;
          return this;
        }
      } else if (!this.setupKey) {
        throw new SetupKeyConfigurationError();
      }
    } catch (error) {
      throw asDatabaseError(error);
    }

    let client;
    let releaseError = null;
    let transactionStarted = false;
    try {
      client = await this.pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;
      await configureTransaction(client);

      if (this.setupKey) {
        const initialData = createInitialData(this.setupKey);
        await client.query(
          `INSERT INTO baynat_state (singleton_id, state)
           VALUES ($1, $2::json)
           ON CONFLICT (singleton_id) DO NOTHING`,
          [STATE_ROW_ID, JSON.stringify(initialData)]
        );
      }

      const selected = await client.query(
        `SELECT state
           FROM baynat_state
          WHERE singleton_id = $1
          FOR UPDATE`,
        [STATE_ROW_ID]
      );
      if (!selected.rows.length) {
        throw new SetupKeyConfigurationError();
      }

      const validated = validateState(
        selected.rows[0].state,
        this.setupKey
      );
      if (validated.data.supervisors.length === 0 && !this.setupKey) {
        throw new SetupKeyConfigurationError();
      }

      if (validated.migrated) {
        await client.query(
          `UPDATE baynat_state
              SET state = $2::json,
                  updated_at = NOW()
            WHERE singleton_id = $1`,
          [STATE_ROW_ID, JSON.stringify(validated.data)]
        );
      }

      await client.query("COMMIT");
      transactionStarted = false;
      this.data = validated.data;
      return this;
    } catch (error) {
      if (transactionStarted && client) {
        releaseError = await rollback(client);
      }
      throw asDatabaseError(error);
    } finally {
      client?.release(releaseError || undefined);
    }
  }

  read(callback) {
    if (!this.data) {
      throw new Error("NetlifyDatabaseStore must be initialized before reading.");
    }
    return callback(this.data);
  }

  async update(callback) {
    let client;
    let transactionStarted = false;
    let callbackError = null;
    let releaseError = null;
    try {
      client = await this.pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;
      await configureTransaction(client);
      const selected = await client.query(
        `SELECT state
           FROM baynat_state
          WHERE singleton_id = $1
          FOR UPDATE`,
        [STATE_ROW_ID]
      );
      const draft = stateFromResult(selected);

      let result;
      try {
        result = await callback(draft);
      } catch (error) {
        callbackError = error;
        throw error;
      }

      await client.query(
        `UPDATE baynat_state
            SET state = $2::json,
                updated_at = NOW()
          WHERE singleton_id = $1`,
        [STATE_ROW_ID, JSON.stringify(draft)]
      );
      await client.query("COMMIT");
      transactionStarted = false;
      this.data = draft;
      return result;
    } catch (error) {
      if (transactionStarted && client) {
        releaseError = await rollback(client);
      }
      throw callbackError || asDatabaseError(error);
    } finally {
      client?.release(releaseError || undefined);
    }
  }

  async consumeProof({ tokenHash, expiresAt }) {
    const expiry = new Date(expiresAt);
    if (
      !/^[a-f0-9]{64}$/.test(String(tokenHash)) ||
      !Number.isFinite(expiry.getTime())
    ) {
      throw new TypeError("A valid proof hash and expiry are required.");
    }
    try {
      const result = await this.pool.query(
        `WITH expired AS (
           DELETE FROM baynat_consumed_proofs
                 WHERE expires_at <= NOW()
         )
         INSERT INTO baynat_consumed_proofs (proof_hash, expires_at)
         VALUES ($1, $2)
         ON CONFLICT (proof_hash) DO NOTHING
         RETURNING proof_hash`,
        [tokenHash, expiry]
      );
      return result.rowCount === 1;
    } catch (error) {
      throw asDatabaseError(error);
    }
  }

  close() {
    // The Netlify Function invocation owns and closes the SDK pool.
  }
}
