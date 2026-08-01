import {
  MissingDatabaseConnectionError,
  getDatabase,
} from "@netlify/database";
import { createBaynatServer } from "../../server.js";
import {
  DatabaseBusyError,
  DatabaseConfigurationError,
  DatabaseStateError,
  DatabaseUnavailableError,
  NetlifyDatabaseStore,
  SetupKeyConfigurationError,
} from "../database-store.js";
import { invokeNodeHandler } from "../node-adapter.js";

function jsonError(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function readConfiguration(environment) {
  const setupKey = String(environment.BAYNAT_SETUP_KEY || "").trim();
  if (setupKey && (setupKey.length < 12 || setupKey.length > 128)) {
    throw new SetupKeyConfigurationError(
      "BAYNAT_SETUP_KEY must contain 12 to 128 characters."
    );
  }
  return { setupKey };
}

export function createNetlifyApiHandler({
  environment = process.env,
  getDatabaseClient = getDatabase,
  logger = console,
  serverOptions = {},
} = {}) {
  return async (request, context = {}) => {
    let configuration;
    try {
      configuration = readConfiguration(environment);
    } catch (error) {
      logger.error?.(`Baynat Netlify configuration error: ${error.message}`);
      if (error instanceof SetupKeyConfigurationError) {
        return jsonError(
          500,
          "SETUP_KEY_CONFIGURATION_ERROR",
          "اضبط BAYNAT_SETUP_KEY بقيمة سرية من ١٢ إلى ١٢٨ خانة قبل تهيئة أول مشرف."
        );
      }
      return jsonError(
        500,
        "SERVICE_CONFIGURATION_ERROR",
        "إعداد بَيّنات غير مكتمل. راجع متغيرات بيئة Netlify."
      );
    }

    let database;
    try {
      try {
        database = await Promise.resolve().then(() => getDatabaseClient());
      } catch (error) {
        if (error instanceof MissingDatabaseConnectionError) {
          throw new DatabaseConfigurationError(error);
        }
        throw new DatabaseUnavailableError(error);
      }
      let store;
      try {
        store = new NetlifyDatabaseStore({
          database,
          setupKey: configuration.setupKey,
        });
      } catch (error) {
        if (error instanceof TypeError) {
          throw new DatabaseConfigurationError(error);
        }
        throw new DatabaseUnavailableError(error);
      }
      const { handler } = await createBaynatServer({
        ...serverOptions,
        store,
        setupKey: configuration.setupKey,
        trustProxy: false,
        nodeEnvironment: serverOptions.nodeEnvironment || "production",
        logger,
      });
      return await invokeNodeHandler(handler, request, context.ip);
    } catch (error) {
      logger.error?.(`Baynat Netlify request failed: ${error.message}`);
      if (error instanceof SetupKeyConfigurationError) {
        return jsonError(
          500,
          "SETUP_KEY_CONFIGURATION_ERROR",
          "اضبط BAYNAT_SETUP_KEY بقيمة سرية من ١٢ إلى ١٢٨ خانة قبل تهيئة أول مشرف."
        );
      }
      if (error instanceof DatabaseStateError) {
        return jsonError(
          500,
          "DATABASE_STATE_INVALID",
          "حالة بَيّنات المحفوظة غير صالحة. أوقفنا الكتابة لحماية البيانات."
        );
      }
      if (error instanceof DatabaseConfigurationError) {
        return jsonError(
          500,
          "DATABASE_CONFIGURATION_ERROR",
          "قاعدة بيانات بَيّنات غير مهيأة. تحقّق من ربط Database وتطبيق الترحيلات."
        );
      }
      if (error instanceof DatabaseBusyError) {
        return jsonError(
          503,
          "DATABASE_BUSY",
          "قاعدة بيانات بَيّنات مشغولة الآن. حاول مرة أخرى بعد قليل."
        );
      }
      if (error instanceof DatabaseUnavailableError) {
        return jsonError(
          503,
          "DATABASE_UNAVAILABLE",
          "تعذّر الوصول إلى قاعدة بيانات بَيّنات. حاول مرة أخرى بعد قليل."
        );
      }
      return jsonError(
        500,
        "SERVICE_CONFIGURATION_ERROR",
        "تعذّر تشغيل خدمة بَيّنات. راجع إعدادات Netlify."
      );
    } finally {
      if (typeof database?.pool?.end === "function") {
        try {
          await database.pool.end();
        } catch (error) {
          logger.error?.(
            `Baynat Netlify database pool close failed: ${error.message}`
          );
        }
      }
    }
  };
}

export default createNetlifyApiHandler();

export const config = {
  path: "/api/*",
};
