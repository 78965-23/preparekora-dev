
import { verifyAdminToken } from "./auth.js";
import { handleAdminRequest } from "./admin.js";
import { handleRevealRequest } from "./reveal.js";

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

function addCors(response, origin) {
  const headers = new Headers(response.headers);

  headers.set("Access-Control-Allow-Origin", origin);
  headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  headers.set("Vary", "Origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export async function handleApiRequest(request, env, ctx) {
  const url = new URL(request.url);
  const origin = env.ALLOWED_ORIGIN || "https://preparekora.dev";
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
      }
    });
  }

  if (path === "/api/health" && request.method === "GET") {
    return jsonResponse(
      { status: "ok", service: "preparekora-dev-api" },
      200,
      origin
    );
  }

  try {
    if (path === "/api/admin" || path.startsWith("/api/admin/")) {
      const auth = await verifyAdminToken(request, env);

      if (!auth || auth.ok !== true) {
        return jsonResponse(
          { error: "Unauthorized" },
          401,
          origin
        );
      }

      const response = await handleAdminRequest(
        request,
        env,
        ctx,
        auth.uid
      );

      return addCors(response, origin);
    }

    if (path === "/api/reveal" || path.startsWith("/api/reveal/")) {
      const response = await handleRevealRequest(request, env, ctx);
      return addCors(response, origin);
    }

    return jsonResponse(
      { error: "API route not found" },
      404,
      origin
    );
  } catch (error) {
    console.error("API router error:", error);

    return jsonResponse(
      { error: "Request failed" },
      500,
      origin
    );
  }
}
