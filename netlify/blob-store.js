import { createInitialData, validateStoredData } from "../server.js";
import { setTimeout as wait } from "node:timers/promises";

const DEFAULT_DATA_KEY = "state";
const DEFAULT_CAS_ATTEMPTS = 100;
const DEFAULT_RETRY_DEADLINE_MS = 5_000;
const DEFAULT_BASE_RETRY_DELAY_MS = 5;
const DEFAULT_MAX_RETRY_DELAY_MS = 100;

export class SetupKeyConfigurationError extends Error {
  constructor(message = "BAYNAT_SETUP_KEY is required until the first supervisor is configured.") {
    super(message);
    this.name = "SetupKeyConfigurationError";
  }
}

function requireEtag(result, operation) {
  if (!result?.etag) {
    throw new Error(`Netlify Blobs did not return an ETag after ${operation}.`);
  }
  return result.etag;
}

export class NetlifyBlobStore {
  constructor({
    blobs,
    setupKey,
    dataKey = DEFAULT_DATA_KEY,
    maxAttempts = DEFAULT_CAS_ATTEMPTS,
    retryDeadlineMs = DEFAULT_RETRY_DEADLINE_MS,
    baseRetryDelayMs = DEFAULT_BASE_RETRY_DELAY_MS,
    maxRetryDelayMs = DEFAULT_MAX_RETRY_DELAY_MS,
    now = Date.now,
    random = Math.random,
    sleep = wait,
  }) {
    if (!blobs) throw new TypeError("A Netlify Blobs store is required.");
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new TypeError("maxAttempts must be a positive integer.");
    }
    if (!Number.isFinite(retryDeadlineMs) || retryDeadlineMs <= 0) {
      throw new TypeError("retryDeadlineMs must be positive.");
    }
    if (!Number.isFinite(baseRetryDelayMs) || baseRetryDelayMs <= 0) {
      throw new TypeError("baseRetryDelayMs must be positive.");
    }
    if (
      !Number.isFinite(maxRetryDelayMs) ||
      maxRetryDelayMs < baseRetryDelayMs
    ) {
      throw new TypeError(
        "maxRetryDelayMs must be at least baseRetryDelayMs."
      );
    }
    if (
      typeof now !== "function" ||
      typeof random !== "function" ||
      typeof sleep !== "function"
    ) {
      throw new TypeError("Retry clock, random source, and sleep must be functions.");
    }
    this.blobs = blobs;
    this.setupKey = String(setupKey || "");
    this.dataKey = dataKey;
    this.maxAttempts = maxAttempts;
    this.retryDeadlineMs = retryDeadlineMs;
    this.baseRetryDelayMs = baseRetryDelayMs;
    this.maxRetryDelayMs = maxRetryDelayMs;
    this.now = now;
    this.random = random;
    this.sleep = sleep;
    this.data = null;
    this.etag = null;
  }

  async waitForRetry(attempt, deadline) {
    if (attempt + 1 >= this.maxAttempts) return false;
    const remaining = deadline - this.now();
    if (remaining <= 0) return false;
    const exponentialDelay = Math.min(
      this.maxRetryDelayMs,
      this.baseRetryDelayMs * 2 ** Math.min(attempt, 30)
    );
    const randomValue = Math.min(
      1,
      Math.max(0, Number(this.random()) || 0)
    );
    const jitteredDelay =
      exponentialDelay / 2 + (exponentialDelay / 2) * randomValue;
    await this.sleep(Math.min(remaining, jitteredDelay));
    return this.now() < deadline;
  }

  async init({ deadline = this.now() + this.retryDeadlineMs } = {}) {
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const entry = await this.blobs.getWithMetadata(this.dataKey, {
        consistency: "strong",
        type: "json",
      });
      if (!entry) {
        if (!this.setupKey) {
          throw new SetupKeyConfigurationError();
        }
        const initialData = createInitialData(this.setupKey);
        const created = await this.blobs.set(
          this.dataKey,
          JSON.stringify(initialData),
          {
            onlyIfNew: true,
          }
        );
        if (!created.modified) {
          if (!(await this.waitForRetry(attempt, deadline))) break;
          continue;
        }
        this.data = initialData;
        this.etag = requireEtag(created, "initialization");
        return this;
      }

      if (!entry.etag) {
        throw new Error("Netlify Blobs returned Baynat data without an ETag.");
      }
      const { data, migrated } = validateStoredData(entry.data, this.setupKey);
      if (data.supervisors.length === 0 && !this.setupKey) {
        throw new SetupKeyConfigurationError();
      }
      if (!migrated) {
        this.data = data;
        this.etag = entry.etag;
        return this;
      }
      const migration = await this.blobs.set(
        this.dataKey,
        JSON.stringify(data),
        {
          onlyIfMatch: entry.etag,
        }
      );
      if (!migration.modified) {
        if (!(await this.waitForRetry(attempt, deadline))) break;
        continue;
      }
      this.data = data;
      this.etag = requireEtag(migration, "migration");
      return this;
    }
    throw new Error("تعذّر تهيئة التخزين المشترك بسبب طلبات متزامنة كثيرة.");
  }

  read(callback) {
    return callback(this.data);
  }

  async update(callback) {
    const deadline = this.now() + this.retryDeadlineMs;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      if (!this.data || !this.etag) await this.init({ deadline });
      const draft = structuredClone(this.data);
      const result = await callback(draft);
      const write = await this.blobs.set(
        this.dataKey,
        JSON.stringify(draft),
        {
          onlyIfMatch: this.etag,
        }
      );
      if (write.modified) {
        this.data = draft;
        this.etag = requireEtag(write, "update");
        return result;
      }
      if (!(await this.waitForRetry(attempt, deadline))) break;
      await this.init({ deadline });
    }
    throw new Error("تعذّر حفظ الطلب بسبب تعديلات متزامنة كثيرة. حاول مرة أخرى.");
  }

  close() {}
}
