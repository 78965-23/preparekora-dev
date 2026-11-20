import { handleApiRequest } from "./router.js";
import { handleScheduledReveal } from "./cron.js";

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin"
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "https://preparekora.dev";

    if (url.pathname === "/api/public-config") {
      if (request.method === "OPTIONS") {
        return jsonResponse({}, 204, origin);
      }

      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405, origin);
      }

      const required = [
        "FIREBASE_WEB_API_KEY",
        "FIREBASE_AUTH_DOMAIN",
        "FIREBASE_PROJECT_ID",
        "FIREBASE_DATABASE_URL",
        "FIREBASE_STORAGE_BUCKET",
        "FIREBASE_MESSAGING_SENDER_ID",
        "FIREBASE_APP_ID"
      ];

      const missing = required.filter((key) => !env[key]);

      if (missing.length) {
        return jsonResponse(
          {
            error: "Firebase configuration is incomplete",
            missing
          },
          503,
          origin
        );
      }

      return jsonResponse(
        {
          firebaseConfig: {
            apiKey: env.FIREBASE_WEB_API_KEY,
            authDomain: env.FIREBASE_AUTH_DOMAIN,
            projectId: env.FIREBASE_PROJECT_ID,
            databaseURL: env.FIREBASE_DATABASE_URL,
            storageBucket: env.FIREBASE_STORAGE_BUCKET,
            messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
            appId: env.FIREBASE_APP_ID,
            measurementId: env.FIREBASE_MEASUREMENT_ID || ""
          },
          adminUid: env.ADMIN_UID || ""
        },
        200,
        origin
      );
    }

    try {
      return await handleApiRequest(request, env, ctx);
    } catch (error) {
      console.error("Preparekora API error:", error);

      return jsonResponse(
        { error: "Internal server error" },
        500,
        origin
      );
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduledReveal(event, env, ctx));
  }
};
