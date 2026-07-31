import { getDeployStore, getStore } from "@netlify/blobs";
import { createBaynatServer } from "../../server.js";
import {
  NetlifyBlobStore,
  SetupKeyConfigurationError,
} from "../blob-store.js";
import { invokeNodeHandler } from "../node-adapter.js";

const DEFAULT_STORE_NAME = "baynat-data";

class DeploymentContextError extends Error {
  constructor(message) {
    super(message);
    this.name = "DeploymentContextError";
  }
}

function jsonError(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function readConfiguration(environment, context) {
  const setupKey = String(environment.BAYNAT_SETUP_KEY || "").trim();
  if (setupKey && (setupKey.length < 12 || setupKey.length > 128)) {
    throw new SetupKeyConfigurationError(
      "BAYNAT_SETUP_KEY must contain 12 to 128 characters."
    );
  }
  const deploymentContext = String(context.deploy?.context || "")
    .trim()
    .toLowerCase();
  if (!deploymentContext) {
    throw new DeploymentContextError(
      "Netlify did not provide context.deploy.context."
    );
  }
  const deployID = String(context.deploy?.id || "").trim();
  if (deploymentContext !== "production" && !deployID) {
    throw new DeploymentContextError(
      "Netlify did not provide context.deploy.id for a non-production deploy."
    );
  }
  const storeName = String(
    environment.BAYNAT_BLOB_STORE || DEFAULT_STORE_NAME
  ).trim();
  if (
    !storeName ||
    storeName.includes("/") ||
    storeName.includes(":") ||
    Buffer.byteLength(storeName) > 64
  ) {
    throw new Error("BAYNAT_BLOB_STORE is not a valid Netlify Blobs store name.");
  }
  return { deployID, deploymentContext, setupKey, storeName };
}

export function createNetlifyApiHandler({
  environment = process.env,
  getBlobStore = (storeName) =>
    getStore({ name: storeName, consistency: "strong" }),
  getDeployBlobStore = (options) => getDeployStore(options),
  logger = console,
  serverOptions = {},
} = {}) {
  return async (request, context = {}) => {
    let configuration;
    try {
      configuration = readConfiguration(environment, context);
    } catch (error) {
      logger.error?.(`Baynat Netlify configuration error: ${error.message}`);
      if (error instanceof SetupKeyConfigurationError) {
        return jsonError(
          500,
          "SETUP_KEY_CONFIGURATION_ERROR",
          "اضبط BAYNAT_SETUP_KEY بقيمة سرية من ١٢ إلى ١٢٨ خانة قبل تهيئة أول مشرف."
        );
      }
      if (error instanceof DeploymentContextError) {
        return jsonError(
          500,
          "DEPLOYMENT_CONTEXT_ERROR",
          "تعذّر تحديد سياق نشر Netlify بأمان."
        );
      }
      return jsonError(
        500,
        "SERVICE_CONFIGURATION_ERROR",
        "إعداد تخزين بَيّنات غير مكتمل. راجع متغيرات بيئة Netlify."
      );
    }

    try {
      const blobs =
        configuration.deploymentContext === "production"
          ? getBlobStore(configuration.storeName)
          : getDeployBlobStore({
              name: configuration.storeName,
              deployID: configuration.deployID,
              consistency: "strong",
            });
      const store = new NetlifyBlobStore({
        blobs,
        setupKey: configuration.setupKey,
      });
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
      return jsonError(
        500,
        "STORAGE_UNAVAILABLE",
        "تعذّر الوصول إلى التخزين المشترك. حاول مرة أخرى بعد قليل."
      );
    }
  };
}

export default createNetlifyApiHandler();

export const config = {
  path: "/api/*",
};
