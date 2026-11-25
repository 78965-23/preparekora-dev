
export default {
  async fetch(request, env) {
    const corsOrigin = env.ALLOWED_ORIGIN || "";

    const origin = request.headers.get("Origin");

    if (origin && origin !== corsOrigin) {
      return Response.json(
        { success: false, error: "Origin not allowed" },
        { status: 403 }
      );
    }

    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(origin ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin"
      } : {})
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      if (!env.FIREBASE_API_KEY) {
        return Response.json(
          { success: false, error: "Firebase configuration missing" },
          { status: 500, headers }
        );
      }

      try {
        const body = await request.json();

        if (
          typeof body.email !== "string" ||
          typeof body.password !== "string" ||
          !body.email.trim() ||
          !body.password
        ) {
          return Response.json(
            { success: false, error: "Email and password required" },
            { status: 400, headers }
          );
        }

        const response = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: body.email.trim(),
              password: body.password,
              returnSecureToken: true
            })
          }
        );

        const result = await response.json();

        if (!response.ok || !result.localId || !result.refreshToken) {
          return Response.json(
            { success: false, error: "Invalid email or password" },
            { status: 401, headers }
          );
        }

        const responseHeaders = new Headers(headers);
        responseHeaders.append(
          "Set-Cookie",
          `__Host-pk_refresh=${encodeURIComponent(result.refreshToken)}; Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=None; Partitioned`
        );

        return new Response(
          JSON.stringify({
            success: true,
            user: {
              uid: result.localId,
              email: result.email
            }
          }),
          { status: 200, headers: responseHeaders }
        );

      } catch {
        return Response.json(
          { success: false, error: "Login request failed" },
          { status: 400, headers }
        );
      }
    }



if (url.pathname === "/api/db/profile" && request.method === "GET") {
  const cookie = (request.headers.get("Cookie") || "")
    .split(";")
    .map(v => v.trim())
    .find(v => v.startsWith("__Host-pk_refresh="));

  if (!cookie) {
    return Response.json(
      { success: false, error: "Not authenticated" },
      { status: 401, headers }
    );
  }

  try {
    const refreshToken = decodeURIComponent(
      cookie.slice("__Host-pk_refresh=".length)
    );

    const tokenResponse = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.id_token || !tokenData.user_id) {
      return Response.json(
        { success: false, error: "Session expired" },
        { status: 401, headers }
      );
    }

    const databaseUrl = (env.FIREBASE_DATABASE_URL || "").replace(/\/+$/, "");

    if (!databaseUrl) throw new Error("Database URL missing");

    const profileUrl = new URL(
      `${databaseUrl}/users/${encodeURIComponent(tokenData.user_id)}/profile.json`
    );

    profileUrl.searchParams.set("auth", tokenData.id_token);

    const dbResponse = await fetch(profileUrl.toString());

    if (!dbResponse.ok) {
      throw new Error(`RTDB read failed: ${dbResponse.status}`);
    }

    let profile = await dbResponse.json();

    if (profile === null) {
      const now = new Date().toISOString();

      const initialProfile = {
        uid: tokenData.user_id,
        displayName: "User",
        createdAt: now,
        updatedAt: now
      };

      const writeResponse = await fetch(profileUrl.toString(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(initialProfile)
      });

      if (!writeResponse.ok) {
        throw new Error(`RTDB write failed: ${writeResponse.status}`);
      }

      profile = await writeResponse.json();
    }

    const responseHeaders = new Headers(headers);

    if (tokenData.refresh_token) {
      responseHeaders.append(
        "Set-Cookie",
        `__Host-pk_refresh=${encodeURIComponent(tokenData.refresh_token)}; Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=None; Partitioned`
      );
    }

    return new Response(JSON.stringify({
      success: true,
      profile
    }), {
      status: 200,
      headers: responseHeaders
    });

  } catch (error) {
    console.error("RTDB_PROFILE_ERROR:", error?.message || String(error));

    return Response.json(
      { success: false, error: "Database request failed" },
      { status: 503, headers }
    );
  }
}

if (url.pathname === "/api/db/catalog" && request.method === "GET") {
  const cookie = (request.headers.get("Cookie") || "")
    .split(";")
    .map(v => v.trim())
    .find(v => v.startsWith("__Host-pk_refresh="));

  if (!cookie) {
    return Response.json(
      { success: false, error: "Not authenticated" },
      { status: 401, headers }
    );
  }

  try {
    const refreshToken = decodeURIComponent(
      cookie.slice("__Host-pk_refresh=".length)
    );

    const tokenResponse = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.id_token) {
      return Response.json(
        { success: false, error: "Session expired" },
        { status: 401, headers }
      );
    }

    const databaseUrl = (env.FIREBASE_DATABASE_URL || "").replace(/\/+$/, "");

    const dbUrl = new URL(`${databaseUrl}/catalog.json`);
    dbUrl.searchParams.set("auth", tokenData.id_token);

    const response = await fetch(dbUrl.toString());

    if (!response.ok) {
      throw new Error(`RTDB catalog read failed: ${response.status}`);
    }

    const catalog = await response.json();

    const responseHeaders = new Headers(headers);

    if (tokenData.refresh_token) {
      responseHeaders.append(
        "Set-Cookie",
        `__Host-pk_refresh=${encodeURIComponent(tokenData.refresh_token)}; Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=None; Partitioned`
      );
    }

    return new Response(JSON.stringify({
      success: true,
      catalog: catalog || {
        subjects: {},
        topics: {}
      }
    }), {
      status: 200,
      headers: responseHeaders
    });

  } catch (error) {
    console.error("RTDB_CATALOG_ERROR:", error?.message || String(error));

    return Response.json(
      { success: false, error: "Catalog request failed" },
      { status: 503, headers }
    );
  }
}

if (url.pathname === "/api/admin/catalog/subjects" && request.method === "POST") {
  const cookie = (request.headers.get("Cookie") || "")
    .split(";")
    .map(v => v.trim())
    .find(v => v.startsWith("__Host-pk_refresh="));

  if (!cookie) {
    return Response.json(
      { success: false, error: "Not authenticated" },
      { status: 401, headers }
    );
  }

  try {
    const refreshToken = decodeURIComponent(
      cookie.slice("__Host-pk_refresh=".length)
    );

    const tokenResponse = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.id_token) {
      return Response.json(
        { success: false, error: "Session expired" },
        { status: 401, headers }
      );
    }

    if (!env.ADMIN_UID || tokenData.user_id !== env.ADMIN_UID) {
      return Response.json(
        { success: false, error: "Admin access required" },
        { status: 403, headers }
      );
    }

    const body = await request.json();

    const code = String(body.code || "").trim().toUpperCase();
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();

    if (!/^[A-Z0-9_-]{2,12}$/.test(code)) {
      return Response.json(
        { success: false, error: "Invalid subject code" },
        { status: 400, headers }
      );
    }

    if (name.length < 2 || name.length > 80 || description.length > 300) {
      return Response.json(
        { success: false, error: "Invalid subject details" },
        { status: 400, headers }
      );
    }

    const databaseUrl = (env.FIREBASE_DATABASE_URL || "").replace(/\/+$/, "");

    const subjectUrl = new URL(
      `${databaseUrl}/catalog/subjects/${code}.json`
    );

    subjectUrl.searchParams.set("auth", tokenData.id_token);

    const existing = await fetch(subjectUrl.toString());

    if (!existing.ok) {
      throw new Error("Subject lookup failed");
    }

    if (await existing.json() !== null) {
      return Response.json(
        { success: false, error: "Subject code already exists" },
        { status: 409, headers }
      );
    }

    const now = new Date().toISOString();

    const subject = {
      code,
      name,
      description,
      active: true,
      createdAt: now,
      updatedAt: now,
      createdBy: tokenData.user_id
    };

    const save = await fetch(subjectUrl.toString(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subject)
    });

    if (!save.ok) throw new Error("Subject save failed");

    return Response.json(
      { success: true, subject: await save.json() },
      { status: 201, headers }
    );

  } catch (error) {
    console.error("SUBJECT_CREATE_ERROR:", error?.message || String(error));

    return Response.json(
      { success: false, error: "Subject creation failed" },
      { status: 503, headers }
    );
  }
}

if (url.pathname === "/api/admin/catalog/topics" && request.method === "POST") {
  const cookie = (request.headers.get("Cookie") || "")
    .split(";")
    .map(v => v.trim())
    .find(v => v.startsWith("__Host-pk_refresh="));

  if (!cookie) {
    return Response.json(
      { success: false, error: "Not authenticated" },
      { status: 401, headers }
    );
  }

  try {
    const refreshToken = decodeURIComponent(
      cookie.slice("__Host-pk_refresh=".length)
    );

    const tokenResponse = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.id_token) {
      return Response.json(
        { success: false, error: "Session expired" },
        { status: 401, headers }
      );
    }

    if (tokenData.user_id !== env.ADMIN_UID) {
      return Response.json(
        { success: false, error: "Admin access required" },
        { status: 403, headers }
      );
    }

    const body = await request.json();
    const subjectCode = String(body.subjectCode || "").trim().toUpperCase();
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();

    if (!/^[A-Z0-9_-]{2,12}$/.test(subjectCode)) {
      return Response.json(
        { success: false, error: "Invalid subject code" },
        { status: 400, headers }
      );
    }

    if (name.length < 2 || name.length > 80 || description.length > 300) {
      return Response.json(
        { success: false, error: "Invalid topic details" },
        { status: 400, headers }
      );
    }

    const words = name.normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .match(/[A-Za-z0-9]+/g) || [];

    const ignored = ["and", "of", "the", "for", "in", "on", "to", "a", "an"];
    const meaningful = words.filter(
      word => !ignored.includes(word.toLowerCase())
    );

    if (!meaningful.length) {
      return Response.json(
        { success: false, error: "Cannot generate topic code from name" },
        { status: 400, headers }
      );
    }

    const code = meaningful.length >= 2
      ? meaningful.slice(0, 2).map(word => word[0]).join("").toUpperCase()
      : meaningful[0].slice(0, 2).toUpperCase();

    const databaseUrl = (env.FIREBASE_DATABASE_URL || "").replace(/\/+$/, "");

    const subjectUrl = new URL(
      `${databaseUrl}/catalog/subjects/${subjectCode}.json`
    );
    subjectUrl.searchParams.set("auth", tokenData.id_token);

    const subjectResponse = await fetch(subjectUrl.toString());
    const subject = await subjectResponse.json();

    if (!subjectResponse.ok || !subject || subject.active === false) {
      return Response.json(
        { success: false, error: "Subject not found or inactive" },
        { status: 404, headers }
      );
    }

    const topicUrl = new URL(
      `${databaseUrl}/catalog/topics/${subjectCode}/${code}.json`
    );
    topicUrl.searchParams.set("auth", tokenData.id_token);

    const existingResponse = await fetch(topicUrl.toString());

    if (!existingResponse.ok) {
      throw new Error("Topic lookup failed");
    }

    if (await existingResponse.json() !== null) {
      return Response.json(
        { success: false, error: "Topic code already exists" },
        { status: 409, headers }
      );
    }

    const now = new Date().toISOString();

    const topic = {
      code,
      name,
      description,
      subjectCode,
      active: true,
      createdAt: now,
      updatedAt: now,
      createdBy: tokenData.user_id
    };

    const saveResponse = await fetch(topicUrl.toString(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(topic)
    });

    if (!saveResponse.ok) throw new Error("Topic save failed");

    return Response.json(
      { success: true, topic: await saveResponse.json() },
      { status: 201, headers }
    );

  } catch (error) {
    console.error("TOPIC_CREATE_ERROR:", error?.message || String(error));

    return Response.json(
      { success: false, error: "Topic creation failed" },
      { status: 503, headers }
    );
  }
}

if (url.pathname === "/api/auth/session" && request.method === "GET") {

  const cookie = (request.headers.get("Cookie") || "")
    .split(";")
    .map(v => v.trim())
    .find(v => v.startsWith("__Host-pk_refresh="));

  if (!cookie) {
    return Response.json(
      { success: false, error: "Not authenticated" },
      { status: 401, headers }
    );
  }

  const clearCookie = () => {
    const h = new Headers(headers);
    h.append("Set-Cookie",
      "__Host-pk_refresh=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=None; Partitioned"
    );
    return h;
  };

  try {
    const refreshToken = decodeURIComponent(
      cookie.slice("__Host-pk_refresh=".length)
    );

    const tokenResponse = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.id_token) {
      return new Response(
        JSON.stringify({ success: false, error: "Session expired. Login again." }),
        { status: 401, headers: clearCookie() }
      );
    }

    const parts = tokenData.id_token.split(".");
    if (parts.length !== 3) throw new Error("Invalid token");

    const decode = value => {
      const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
      return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
    };

    const jwtHeader = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));

    if (jwtHeader.alg !== "RS256" || !jwtHeader.kid) {
      throw new Error("Invalid JWT header");
    }

    const keysResponse = await fetch(
      "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
    );

    if (!keysResponse.ok) throw new Error("Signing keys unavailable");

    const keyData = await keysResponse.json();
    const jwk = keyData.keys.find(k =>
      k.kid === jwtHeader.kid && k.alg === "RS256"
    );

    if (!jwk) throw new Error("Signing key not found");

    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signatureValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      decode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );

    const now = Math.floor(Date.now() / 1000);
    const projectId = env.FIREBASE_PROJECT_ID;

    const claimsValid =
      claims.aud === projectId &&
      claims.iss === `https://securetoken.google.com/${projectId}` &&
      claims.sub &&
      claims.sub === tokenData.user_id &&
      claims.exp > now &&
      claims.iat <= now + 60 &&
      claims.auth_time <= now + 60;

    if (!signatureValid || !claimsValid) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid session" }),
        { status: 401, headers: clearCookie() }
      );
    }

    const responseHeaders = new Headers(headers);
    responseHeaders.append(
      "Set-Cookie",
      `__Host-pk_refresh=${encodeURIComponent(tokenData.refresh_token || refreshToken)}; Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=None; Partitioned`
    );

    return new Response(JSON.stringify({
      success: true,
      user: {
        uid: claims.sub,
        email: claims.email || null,
        role: claims.sub === env.ADMIN_UID ? "admin" : "user"
      }
    }), { status: 200, headers: responseHeaders });

  } catch {
    return Response.json(
      { success: false, error: "Session verification unavailable" },
      { status: 503, headers }
    );
  }
}

if (url.pathname === "/api/auth/logout" && request.method === "POST") {
  const logoutHeaders = new Headers(headers);

  logoutHeaders.append(
    "Set-Cookie",
    "__Host-pk_refresh=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=None; Partitioned"
  );

  return new Response(JSON.stringify({
    success: true,
    message: "Logged out successfully"
  }), {
    status: 200,
    headers: logoutHeaders
  });
}

if (url.pathname === "/api/health" && request.method === "GET") {

  let serviceAccountValid = false;

  try {
    const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || "");
    serviceAccountValid = Boolean(
      account.client_email &&
      account.private_key &&
      account.project_id === env.FIREBASE_PROJECT_ID
    );
  } catch {}

  return Response.json({
    success: true,
    service: "preparekora-studio-api",
    status: "running",
    configuration: {
      firebaseApiKey: Boolean(env.FIREBASE_API_KEY),
      databaseUrl: Boolean(env.FIREBASE_DATABASE_URL),
      projectId: Boolean(env.FIREBASE_PROJECT_ID),
      adminUid: Boolean(env.ADMIN_UID),
      serviceAccount: serviceAccountValid
    }
  }, { headers });
}

if (url.pathname === "/api/admin/questions" && request.method === "POST") {
  const cookie = (request.headers.get("Cookie") || "")
    .split(";")
    .map(v => v.trim())
    .find(v => v.startsWith("__Host-pk_refresh="));

  if (!cookie) {
    return Response.json(
      { success: false, error: "Not authenticated" },
      { status: 401, headers }
    );
  }

  try {
    if (
      !env.FIREBASE_API_KEY ||
      !env.FIREBASE_DATABASE_URL ||
      !env.ADMIN_UID
    ) {
      return Response.json(
        { success: false, error: "Server configuration missing" },
        { status: 500, headers }
      );
    }

    const refreshToken = decodeURIComponent(
      cookie.slice("__Host-pk_refresh=".length)
    );

    const tokenResponse = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.id_token || !tokenData.user_id) {
      return Response.json(
        { success: false, error: "Session expired" },
        { status: 401, headers }
      );
    }

    if (tokenData.user_id !== env.ADMIN_UID) {
      return Response.json(
        { success: false, error: "Admin access required" },
        { status: 403, headers }
      );
    }

    const respond = (data, status = 200) => {
      const responseHeaders = new Headers(headers);

      if (tokenData.refresh_token) {
        responseHeaders.append(
          "Set-Cookie",
          `__Host-pk_refresh=${encodeURIComponent(tokenData.refresh_token)}; Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=None; Partitioned`
        );
      }

      return new Response(JSON.stringify(data), {
        status,
        headers: responseHeaders
      });
    };

    const contentLength = Number(
      request.headers.get("Content-Length") || "0"
    );

    if (contentLength > 32768) {
      return respond(
        { success: false, error: "Question data is too large" },
        413
      );
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return respond(
        { success: false, error: "Invalid JSON request" },
        400
      );
    }

    const typeInput = String(body.type || "").trim().toUpperCase();
    const type = typeInput === "Q&A" ? "QA" : typeInput;

    const subjectCode = String(body.subjectCode || "")
      .trim()
      .toUpperCase();

    const topicCode = String(body.topicCode || "")
      .trim()
      .toUpperCase();

    if (!["QA", "MCQ"].includes(type)) {
      return respond(
        { success: false, error: "Question type must be QA or MCQ" },
        400
      );
    }

    if (!/^[A-Z0-9_-]{2,12}$/.test(subjectCode)) {
      return respond(
        { success: false, error: "Invalid subject code" },
        400
      );
    }

    if (!/^[A-Z0-9_-]{2,12}$/.test(topicCode)) {
      return respond(
        { success: false, error: "Invalid topic code" },
        400
      );
    }

    const readPair = (value, maxLength = 5000) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }

      const en = typeof value.en === "string" ? value.en.trim() : "";
      const as = typeof value.as === "string" ? value.as.trim() : "";

      if (
        !en ||
        !as ||
        en.length > maxLength ||
        as.length > maxLength
      ) {
        return null;
      }

      return { en, as };
    };

    const question = readPair(body.question);

    if (!question) {
      return respond(
        { success: false, error: "English and Assamese question are required" },
        400
      );
    }

    let answer = null;
    let options = null;
    let correctOption = null;
    let explanation = null;

    if (type === "QA") {
      answer = readPair(body.answer);

      if (!answer) {
        return respond(
          { success: false, error: "English and Assamese answer are required" },
          400
        );
      }

      if (body.explanation !== undefined && body.explanation !== null) {
        explanation = readPair(body.explanation);

        if (!explanation) {
          return respond(
            { success: false, error: "Invalid explanation format" },
            400
          );
        }
      }
    }

    if (type === "MCQ") {
      if (!body.options || typeof body.options !== "object") {
        return respond(
          { success: false, error: "Four options are required" },
          400
        );
      }

      options = {};

      for (const letter of ["A", "B", "C", "D"]) {
        const option = readPair(body.options[letter], 2000);

        if (!option) {
          return respond(
            {
              success: false,
              error: `Valid English and Assamese option ${letter} is required`
            },
            400
          );
        }

        options[letter] = option;
      }

      correctOption = String(body.correctOption || "")
        .trim()
        .toUpperCase();

      if (!["A", "B", "C", "D"].includes(correctOption)) {
        return respond(
          { success: false, error: "Invalid correct option" },
          400
        );
      }

      if (body.explanation !== undefined && body.explanation !== null) {
        explanation = readPair(body.explanation);

        if (!explanation) {
          return respond(
            {
              success: false,
              error: "Explanation must contain English and Assamese text"
            },
            400
          );
        }
      }
    }

    const databaseUrl = env.FIREBASE_DATABASE_URL.replace(/\/+$/, "");

    const subjectUrl = new URL(
      `${databaseUrl}/catalog/subjects/${subjectCode}.json`
    );

    subjectUrl.searchParams.set("auth", tokenData.id_token);

    const subjectResponse = await fetch(subjectUrl.toString());

    if (!subjectResponse.ok) {
      throw new Error("Subject lookup failed");
    }

    const subject = await subjectResponse.json();

    if (!subject || subject.active === false) {
      return respond(
        { success: false, error: "Subject not found or inactive" },
        404
      );
    }

    const topicUrl = new URL(
      `${databaseUrl}/catalog/topics/${subjectCode}/${topicCode}.json`
    );

    topicUrl.searchParams.set("auth", tokenData.id_token);

    const topicResponse = await fetch(topicUrl.toString());

    if (!topicResponse.ok) {
      throw new Error("Topic lookup failed");
    }

    const topic = await topicResponse.json();

    if (!topic || topic.active === false) {
      return respond(
        { success: false, error: "Topic not found or inactive" },
        404
      );
    }

    const dateParts = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Kolkata",
      month: "2-digit",
      year: "2-digit"
    }).formatToParts(new Date());

    const month = dateParts.find(p => p.type === "month").value;
    const year = dateParts.find(p => p.type === "year").value;
    const monthCode = `${month}${year}`;

    const counterUrl = new URL(
      `${databaseUrl}/system/questionIdCounters/${type}/${subjectCode}/${topicCode}/${monthCode}.json`
    );

    counterUrl.searchParams.set("auth", tokenData.id_token);

    let allocated = null;

    for (let attempt = 0; attempt < 10; attempt++) {
      const counterRead = await fetch(counterUrl.toString(), {
        headers: {
          "X-Firebase-ETag": "true"
        }
      });

      if (!counterRead.ok) {
        throw new Error("Question counter read failed");
      }

      const counterETag = counterRead.headers.get("ETag");

      if (!counterETag) {
        throw new Error("Question counter ETag missing");
      }

      const currentCounter = await counterRead.json();

      let setNumber = 1;
      let serialNumber = 0;

      if (currentCounter !== null) {
        if (
          !Number.isInteger(currentCounter.setNumber) ||
          !Number.isInteger(currentCounter.serialNumber) ||
          currentCounter.setNumber < 1 ||
          currentCounter.serialNumber < 1 ||
          currentCounter.setNumber > 99 ||
          currentCounter.serialNumber > 99
        ) {
          throw new Error("Invalid question counter data");
        }

        setNumber = currentCounter.setNumber;
        serialNumber = currentCounter.serialNumber;
      }

      if (serialNumber >= 99) {
        setNumber += 1;
        serialNumber = 0;
      }

      if (setNumber > 99) {
        return respond(
          { success: false, error: "Question ID capacity reached" },
          409
        );
      }

      serialNumber += 1;

      const nextCounter = {
        setNumber,
        serialNumber,
        updatedAt: new Date().toISOString(),
        updatedBy: tokenData.user_id
      };

      const counterWrite = await fetch(counterUrl.toString(), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": counterETag
        },
        body: JSON.stringify(nextCounter)
      });

      if (counterWrite.status === 412) {
        continue;
      }

      if (!counterWrite.ok) {
        throw new Error("Question counter update failed");
      }

      allocated = {
        setNumber,
        serialNumber
      };

      break;
    }

    if (!allocated) {
      return respond(
        { success: false, error: "Could not allocate a unique question ID. Retry." },
        503
      );
    }

    const setCode = String(allocated.setNumber).padStart(2, "0");
    const serialCode = String(allocated.serialNumber).padStart(3, "0");

    const questionId = [
      "PK",
      type,
      setCode,
      subjectCode,
      topicCode,
      monthCode,
      serialCode
    ].join("/");

    const idKey = questionId.replaceAll("/", "_");

    const questionUrl = new URL(
      `${databaseUrl}/questions/${subjectCode}/${topicCode}/${idKey}.json`
    );

    questionUrl.searchParams.set("auth", tokenData.id_token);

    const questionCheck = await fetch(questionUrl.toString(), {
      headers: {
        "X-Firebase-ETag": "true"
      }
    });

    if (!questionCheck.ok) {
      throw new Error("Question ID lookup failed");
    }

    const questionETag = questionCheck.headers.get("ETag");
    const existingQuestion = await questionCheck.json();

    if (!questionETag) {
      throw new Error("Question ETag missing");
    }

    if (existingQuestion !== null) {
      return respond(
        { success: false, error: "Question ID already exists. Contact admin." },
        409
      );
    }

    const now = new Date().toISOString();

    const questionRecord = {
      id: questionId,
      idKey,
      type,
      setCode,
      setNumber: allocated.setNumber,
      serialNumber: allocated.serialNumber,
      subjectCode,
      topicCode,
      question,
      active: true,
      createdAt: now,
      updatedAt: now,
      createdBy: tokenData.user_id
    };

    if (type === "QA") {
      questionRecord.answer = answer;

      if (explanation) {
        questionRecord.explanation = explanation;
      }
    }

    if (type === "MCQ") {
      questionRecord.options = options;
      questionRecord.correctOption = correctOption;
      if (explanation) questionRecord.explanation = explanation;
    }

    const saveResponse = await fetch(questionUrl.toString(), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": questionETag
      },
      body: JSON.stringify(questionRecord)
    });

    if (saveResponse.status === 412) {
      return respond(
        { success: false, error: "Question ID conflict. Please retry." },
        409
      );
    }

    if (!saveResponse.ok) {
      throw new Error("Question save failed");
    }

    return respond(
      {
        success: true,
        message: "Question saved successfully",
        question: await saveResponse.json()
      },
      201
    );

  } catch (error) {
    console.error(
      "QUESTION_CREATE_ERROR:",
      error?.message || String(error)
    );

    return Response.json(
      { success: false, error: "Question creation failed" },
      { status: 503, headers }
    );
  }
}

if (url.pathname === "/api/admin/questions" && request.method === "PATCH") {
  const cookie = (request.headers.get("Cookie") || "")
    .split(";")
    .map(v => v.trim())
    .find(v => v.startsWith("__Host-pk_refresh="));

  if (!cookie) {
    return Response.json(
      { success: false, error: "Not authenticated" },
      { status: 401, headers }
    );
  }

  try {
    if (
      !env.FIREBASE_API_KEY ||
      !env.FIREBASE_DATABASE_URL ||
      !env.ADMIN_UID
    ) {
      return Response.json(
        { success: false, error: "Server configuration missing" },
        { status: 500, headers }
      );
    }

    const refreshToken = decodeURIComponent(
      cookie.slice("__Host-pk_refresh=".length)
    );

    const tokenResponse = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.id_token || !tokenData.user_id) {
      return Response.json(
        { success: false, error: "Session expired" },
        { status: 401, headers }
      );
    }

    if (tokenData.user_id !== env.ADMIN_UID) {
      return Response.json(
        { success: false, error: "Admin access required" },
        { status: 403, headers }
      );
    }

    const respond = (data, status = 200) => {
      const responseHeaders = new Headers(headers);

      if (tokenData.refresh_token) {
        responseHeaders.append(
          "Set-Cookie",
          `__Host-pk_refresh=${encodeURIComponent(tokenData.refresh_token)}; Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=None; Partitioned`
        );
      }

      return new Response(JSON.stringify(data), {
        status,
        headers: responseHeaders
      });
    };

    const contentLength = Number(
      request.headers.get("Content-Length") || "0"
    );

    if (contentLength > 32768) {
      return respond(
        { success: false, error: "Question data is too large" },
        413
      );
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return respond(
        { success: false, error: "Invalid JSON request" },
        400
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return respond(
        { success: false, error: "Invalid question data" },
        400
      );
    }

    const questionId = String(body.id || "").trim();

    const idMatch = /^PK\/(MCQ|QA)\/(\d{2})\/([A-Z0-9_-]{2,12})\/([A-Z0-9_-]{2,12})\/(\d{4})\/(\d{3})$/.exec(questionId);

    if (!idMatch) {
      return respond(
        { success: false, error: "Invalid Question ID" },
        400
      );
    }

    const type = idMatch[1];
    const subjectCode = idMatch[3];
    const topicCode = idMatch[4];
    const idKey = questionId.replace(/\//g, "_");

    if (
      body.type !== undefined &&
      String(body.type).toUpperCase() !== type
    ) {
      return respond(
        { success: false, error: "Question type cannot be changed" },
        400
      );
    }

    const readPair = (value, maxLength = 5000) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }

      const en = typeof value.en === "string" ? value.en.trim() : "";
      const as = typeof value.as === "string" ? value.as.trim() : "";

      if (
        !en ||
        !as ||
        en.length > maxLength ||
        as.length > maxLength
      ) {
        return null;
      }

      return { en, as };
    };

    const question = readPair(body.question);

    if (!question) {
      return respond(
        { success: false, error: "Valid bilingual question is required" },
        400
      );
    }

    let answer = null;
    let options = null;
    let correctOption = null;
    let explanation = null;

    const hasExplanation =
      Object.prototype.hasOwnProperty.call(body, "explanation");

    if (type === "QA") {
      answer = readPair(body.answer);

      if (!answer) {
        return respond(
          { success: false, error: "Valid bilingual answer is required" },
          400
        );
      }

      if (hasExplanation && body.explanation !== null) {
        explanation = readPair(body.explanation);

        if (!explanation) {
          return respond(
            { success: false, error: "Invalid explanation format" },
            400
          );
        }
      }
    }

    if (type === "MCQ") {
      if (
        !body.options ||
        typeof body.options !== "object" ||
        Array.isArray(body.options)
      ) {
        return respond(
          { success: false, error: "Four options are required" },
          400
        );
      }

      options = {};

      for (const letter of ["A", "B", "C", "D"]) {
        const option = readPair(body.options[letter], 2000);

        if (!option) {
          return respond(
            {
              success: false,
              error: `Valid bilingual option ${letter} is required`
            },
            400
          );
        }

        options[letter] = option;
      }

      correctOption = String(body.correctOption || "")
        .trim()
        .toUpperCase();

      if (!["A", "B", "C", "D"].includes(correctOption)) {
        return respond(
          { success: false, error: "Invalid correct option" },
          400
        );
      }

      explanation = readPair(body.explanation);

      if (!explanation) {
        return respond(
          { success: false, error: "Valid bilingual explanation is required" },
          400
        );
      }
    }

    const databaseUrl = env.FIREBASE_DATABASE_URL.replace(/\/+$/, "");

    const questionUrl = new URL(
      `${databaseUrl}/questions/${subjectCode}/${topicCode}/${idKey}.json`
    );

    questionUrl.searchParams.set("auth", tokenData.id_token);

    // Read the existing record and its ETag.
    const existingResponse = await fetch(questionUrl.toString(), {
      headers: {
        "X-Firebase-ETag": "true"
      }
    });

    if (!existingResponse.ok) {
      throw new Error("Question lookup failed");
    }

    const etag = existingResponse.headers.get("ETag");
    const existing = await existingResponse.json();

    if (!existing) {
      return respond(
        { success: false, error: "Question not found" },
        404
      );
    }

    if (!etag) {
      throw new Error("Question ETag missing");
    }

    if (
      existing.id !== questionId ||
      existing.type !== type ||
      existing.subjectCode !== subjectCode ||
      existing.topicCode !== topicCode
    ) {
      return respond(
        { success: false, error: "Question record identity mismatch" },
        409
      );
    }

    if (existing.active === false) {
      return respond(
        { success: false, error: "Inactive question must be restored before editing" },
        409
      );
    }

    const currentVersion =
      existing.version === undefined ? 1 : existing.version;

    if (
      !Number.isInteger(currentVersion) ||
      currentVersion < 1
    ) {
      throw new Error("Invalid question version");
    }

    const nextVersion = currentVersion + 1;
    const now = new Date().toISOString();

    // Preserve the complete previous record without recursive history.
    const previousSnapshot = { ...existing };

    delete previousSnapshot.versionHistory;
    delete previousSnapshot.auditLog;

    const versionHistory =
      existing.versionHistory &&
      typeof existing.versionHistory === "object" &&
      !Array.isArray(existing.versionHistory)
        ? { ...existing.versionHistory }
        : {};

    const auditLog =
      existing.auditLog &&
      typeof existing.auditLog === "object" &&
      !Array.isArray(existing.auditLog)
        ? { ...existing.auditLog }
        : {};

    const historyKey =
      `v${String(currentVersion).padStart(6, "0")}`;

    const auditKey =
      `v${String(nextVersion).padStart(6, "0")}`;

    if (versionHistory[historyKey] || auditLog[auditKey]) {
      return respond(
        { success: false, error: "Version history conflict. Reload the question." },
        409
      );
    }

    // Save previous version.
    versionHistory[historyKey] = {
      version: currentVersion,
      savedAt: now,
      savedBy: tokenData.user_id,
      record: previousSnapshot
    };

    // Record audit event.
    auditLog[auditKey] = {
      action: "EDIT",
      fromVersion: currentVersion,
      toVersion: nextVersion,
      performedAt: now,
      performedBy: tokenData.user_id
    };

    // Preserve unknown and future-compatible fields.
    const updatedRecord = {
      ...existing,
      question,
      updatedAt: now,
      updatedBy: tokenData.user_id,
      version: nextVersion,
      versionHistory,
      auditLog
    };

    if (type === "QA") {
      updatedRecord.answer = answer;

      if (hasExplanation) {
        if (body.explanation === null) {
          delete updatedRecord.explanation;
        } else {
          updatedRecord.explanation = explanation;
        }
      }
    }

    if (type === "MCQ") {
      updatedRecord.options = options;
      updatedRecord.correctOption = correctOption;
      updatedRecord.explanation = explanation;
    }

    // Conditional write prevents simultaneous edits from overwriting each other.
    const saveResponse = await fetch(questionUrl.toString(), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": etag
      },
      body: JSON.stringify(updatedRecord)
    });

    if (saveResponse.status === 412) {
      return respond(
        {
          success: false,
          error: "Question was modified by another request. Reload and retry."
        },
        409
      );
    }

    if (!saveResponse.ok) {
      throw new Error("Question update failed");
    }

    return respond({
      success: true,
      message: "Question updated successfully",
      question: {
        id: updatedRecord.id,
        type: updatedRecord.type,
        version: updatedRecord.version,
        updatedAt: updatedRecord.updatedAt,
        updatedBy: updatedRecord.updatedBy
      }
    });

  } catch (error) {
    console.error(
      "QUESTION_UPDATE_ERROR:",
      error?.message || String(error)
    );

    return Response.json(
      { success: false, error: "Question update failed" },
      { status: 503, headers }
    );
  }
}


if (url.pathname === "/api/admin/questions" && request.method === "GET") {
  const cookie = (request.headers.get("Cookie") || "")
    .split(";")
    .map(v => v.trim())
    .find(v => v.startsWith("__Host-pk_refresh="));

  if (!cookie) {
    return Response.json(
      { success: false, error: "Not authenticated" },
      { status: 401, headers }
    );
  }

  try {
    if (
      !env.FIREBASE_API_KEY ||
      !env.FIREBASE_DATABASE_URL ||
      !env.ADMIN_UID
    ) {
      return Response.json(
        { success: false, error: "Server configuration missing" },
        { status: 500, headers }
      );
    }

    const refreshToken = decodeURIComponent(
      cookie.slice("__Host-pk_refresh=".length)
    );

    const tokenResponse = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.id_token || !tokenData.user_id) {
      return Response.json(
        { success: false, error: "Session expired" },
        { status: 401, headers }
      );
    }

    if (tokenData.user_id !== env.ADMIN_UID) {
      return Response.json(
        { success: false, error: "Admin access required" },
        { status: 403, headers }
      );
    }

    const respond = (data, status = 200) => {
      const responseHeaders = new Headers(headers);

      if (tokenData.refresh_token) {
        responseHeaders.append(
          "Set-Cookie",
          `__Host-pk_refresh=${encodeURIComponent(tokenData.refresh_token)}; Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=None; Partitioned`
        );
      }

      return new Response(JSON.stringify(data), {
        status,
        headers: responseHeaders
      });
    };

    const subjectCode = String(
      url.searchParams.get("subjectCode") || ""
    ).trim().toUpperCase();

    const topicCode = String(
      url.searchParams.get("topicCode") || ""
    ).trim().toUpperCase();

    const typeInput = String(
      url.searchParams.get("type") || ""
    ).trim().toUpperCase();

    const type = typeInput === "Q&A" ? "QA" : typeInput;

    if (!/^[A-Z0-9_-]{2,12}$/.test(subjectCode)) {
      return respond(
        { success: false, error: "Valid subjectCode is required" },
        400
      );
    }

    if (!/^[A-Z0-9_-]{2,12}$/.test(topicCode)) {
      return respond(
        { success: false, error: "Valid topicCode is required" },
        400
      );
    }

    if (type && !["QA", "MCQ"].includes(type)) {
      return respond(
        { success: false, error: "Invalid question type" },
        400
      );
    }

    const databaseUrl = env.FIREBASE_DATABASE_URL.replace(/\/+$/, "");

    const subjectUrl = new URL(
      `${databaseUrl}/catalog/subjects/${subjectCode}.json`
    );

    subjectUrl.searchParams.set("auth", tokenData.id_token);

    const subjectResponse = await fetch(subjectUrl.toString());

    if (!subjectResponse.ok) {
      throw new Error("Subject lookup failed");
    }

    const subject = await subjectResponse.json();

    if (!subject || subject.active === false) {
      return respond(
        { success: false, error: "Subject not found or inactive" },
        404
      );
    }

    const topicUrl = new URL(
      `${databaseUrl}/catalog/topics/${subjectCode}/${topicCode}.json`
    );

    topicUrl.searchParams.set("auth", tokenData.id_token);

    const topicResponse = await fetch(topicUrl.toString());

    if (!topicResponse.ok) {
      throw new Error("Topic lookup failed");
    }

    const topic = await topicResponse.json();

    if (!topic || topic.active === false) {
      return respond(
        { success: false, error: "Topic not found or inactive" },
        404
      );
    }

    const questionsUrl = new URL(
      `${databaseUrl}/questions/${subjectCode}/${topicCode}.json`
    );

    questionsUrl.searchParams.set("auth", tokenData.id_token);

    const questionsResponse = await fetch(questionsUrl.toString());

    if (!questionsResponse.ok) {
      throw new Error("Questions lookup failed");
    }

    const storedQuestions = await questionsResponse.json();

    let questions = Object.values(storedQuestions || {})
      .filter(question =>
        question &&
        typeof question === "object" &&
        !Array.isArray(question)
      );

    if (type) {
      questions = questions.filter(question => question.type === type);
    }

    questions.sort((a, b) =>
      String(b.createdAt || "").localeCompare(
        String(a.createdAt || "")
      )
    );

    return respond({
      success: true,
      subjectCode,
      topicCode,
      type: type || "ALL",
      count: questions.length,
      questions
    });

  } catch (error) {
    console.error(
      "QUESTION_RETRIEVAL_ERROR:",
      error?.message || String(error)
    );

    return Response.json(
      { success: false, error: "Question retrieval failed" },
      { status: 503, headers }
    );
  }
}

if (
  url.pathname === "/api/admin/image-generations" &&
  ["GET", "POST"].includes(request.method)
) {
  const cookie = (request.headers.get("Cookie") || "")
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith("__Host-pk_refresh="));

  if (!cookie) {
    return Response.json(
      { success: false, error: "Not authenticated" },
      { status: 401, headers }
    );
  }

  try {
    if (!env.FIREBASE_API_KEY || !env.FIREBASE_DATABASE_URL || !env.ADMIN_UID) {
      return Response.json(
        { success: false, error: "Server configuration missing" },
        { status: 500, headers }
      );
    }

    const refreshToken = decodeURIComponent(
      cookie.slice("__Host-pk_refresh=".length)
    );

    const tokenResponse = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.id_token || !tokenData.user_id) {
      return Response.json(
        { success: false, error: "Session expired" },
        { status: 401, headers }
      );
    }

    if (tokenData.user_id !== env.ADMIN_UID) {
      return Response.json(
        { success: false, error: "Admin access required" },
        { status: 403, headers }
      );
    }

    const respond = (data, status = 200) => {
      const responseHeaders = new Headers(headers);
      if (tokenData.refresh_token) {
        responseHeaders.append(
          "Set-Cookie",
          `__Host-pk_refresh=${encodeURIComponent(tokenData.refresh_token)}; Max-Age=2592000; Path=/; Secure; HttpOnly; SameSite=None; Partitioned`
        );
      }
      return new Response(JSON.stringify(data), {
        status,
        headers: responseHeaders
      });
    };

    const databaseUrl = env.FIREBASE_DATABASE_URL.replace(/\/+$/, "");
    const subjectCode = String(
      request.method === "GET"
        ? url.searchParams.get("subjectCode") || ""
        : ""
    ).trim().toUpperCase();

    if (request.method === "GET") {
      if (!/^[A-Z0-9_-]{2,12}$/.test(subjectCode)) {
        return respond(
          { success: false, error: "Valid subjectCode is required" },
          400
        );
      }

      const historyUrl = new URL(
        `${databaseUrl}/imageGenerations/${subjectCode}.json`
      );
      historyUrl.searchParams.set("auth", tokenData.id_token);

      const historyResponse = await fetch(historyUrl.toString());
      if (!historyResponse.ok) throw new Error("Image history lookup failed");

      const stored = await historyResponse.json();
      const imageGenerations = Object.values(stored || {})
        .filter(item => item && typeof item === "object")
        .sort((a, b) =>
          String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
        )
        .slice(0, 50);

      return respond({ success: true, imageGenerations });
    }

    const contentLength = Number(request.headers.get("Content-Length") || "0");
    if (contentLength > 16000) {
      return respond(
        { success: false, error: "Image generation metadata is too large" },
        413
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return respond({ success: false, error: "Invalid JSON request" }, 400);
    }

    const code = String(body.subjectCode || "").trim().toUpperCase();
    const topicCode = String(body.topicCode || "").trim().toUpperCase();
    const ratio = String(body.ratio || "").trim();
    const background = String(body.background || "").trim().toLowerCase();
    const borderRadius = Number(body.borderRadius);
    const width = Number(body.width);
    const height = Number(body.height);
    const pageNumber = Number(body.pageNumber);
    const pageCount = Number(body.pageCount);
    const questionIds = Array.isArray(body.questionIds) ? body.questionIds : [];

    if (!/^[A-Z0-9_-]{2,12}$/.test(code) || !/^[A-Z0-9_-]{2,12}$/.test(topicCode)) {
      return respond({ success: false, error: "Invalid subject or topic code" }, 400);
    }
    if (!["4:5", "1:1", "4:3", "9:16", "16:9"].includes(ratio)) {
      return respond({ success: false, error: "Invalid image ratio" }, 400);
    }
    if (!/^#[0-9a-f]{6}$/.test(background)) {
      return respond({ success: false, error: "Invalid background colour" }, 400);
    }
    if (!Number.isInteger(borderRadius) || borderRadius < 0 || borderRadius > 32) {
      return respond({ success: false, error: "Invalid image border radius" }, 400);
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 500 || height < 500 || width > 7000 || height > 7000) {
      return respond({ success: false, error: "Invalid image dimensions" }, 400);
    }
    if (!Number.isInteger(pageNumber) || !Number.isInteger(pageCount) || pageNumber < 1 || pageCount < pageNumber || pageCount > 500) {
      return respond({ success: false, error: "Invalid page number" }, 400);
    }
    if (!questionIds.length || questionIds.length > 100 || questionIds.some(id => typeof id !== "string" || id.length > 120)) {
      return respond({ success: false, error: "Valid question IDs are required" }, 400);
    }

    const subjectUrl = new URL(`${databaseUrl}/catalog/subjects/${code}.json`);
    subjectUrl.searchParams.set("auth", tokenData.id_token);
    const subjectResponse = await fetch(subjectUrl.toString());
    const subject = await subjectResponse.json();
    if (!subjectResponse.ok || !subject || subject.active === false) {
      return respond({ success: false, error: "Subject not found or inactive" }, 404);
    }

    const topicUrl = new URL(`${databaseUrl}/catalog/topics/${code}/${topicCode}.json`);
    topicUrl.searchParams.set("auth", tokenData.id_token);
    const topicResponse = await fetch(topicUrl.toString());
    const topic = await topicResponse.json();
    if (!topicResponse.ok || !topic || topic.active === false) {
      return respond({ success: false, error: "Topic not found or inactive" }, 404);
    }

    // Confirm every linked Question ID exists under this subject/topic.
    const questionsUrl = new URL(`${databaseUrl}/questions/${code}/${topicCode}.json`);
    questionsUrl.searchParams.set("auth", tokenData.id_token);
    const questionsResponse = await fetch(questionsUrl.toString());
    if (!questionsResponse.ok) throw new Error("Question validation failed");
    const storedQuestions = await questionsResponse.json();
    const availableIds = new Set(
      Object.values(storedQuestions || {}).map(item => item && item.id).filter(Boolean)
    );
    if (questionIds.some(id => !availableIds.has(id))) {
      return respond(
        { success: false, error: "One or more Question IDs could not be verified" },
        400
      );
    }

    const dateParts = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Kolkata",
      month: "2-digit",
      year: "2-digit"
    }).formatToParts(new Date());
    const monthCode = `${dateParts.find(part => part.type === "month").value}${dateParts.find(part => part.type === "year").value}`;

    const imageRoot = `${databaseUrl}/imageGenerations/${code}`;
    let savedRecord = null;

    // The conditional RTDB write prevents duplicate IDs, including concurrent requests.
    for (let attempt = 0; attempt < 8; attempt++) {
      const randomPart = crypto.randomUUID().replaceAll("-", "").toUpperCase();
      const imageId = `PK/IMG/${code}/${topicCode}/${monthCode}/${randomPart}`;
      const idKey = imageId.replaceAll("/", "_");
      const recordUrl = new URL(`${imageRoot}/${idKey}.json`);
      recordUrl.searchParams.set("auth", tokenData.id_token);

      const check = await fetch(recordUrl.toString(), {
        headers: { "X-Firebase-ETag": "true" }
      });
      if (!check.ok) throw new Error("Image ID uniqueness check failed");
      const etag = check.headers.get("ETag");
      const existing = await check.json();
      if (!etag || existing !== null) continue;

      const now = new Date().toISOString();
      const record = {
        imageId,
        idKey,
        subjectCode: code,
        subjectName: String(body.subjectName || subject.name || code).slice(0, 100),
        topicCode,
        topicName: String(body.topicName || topic.name || topicCode).slice(0, 100),
        ratio,
        background,
        borderRadius,
        heading: String(body.heading || topic.name || subject.name || "Questions").slice(0, 100),
        pageNumber,
        pageCount,
        width,
        height,
        questionRange: String(body.questionRange || "").slice(0, 40),
        questionIds,
        qrUrl: String(body.qrUrl || "").slice(0, 500),
        createdAt: now,
        createdBy: tokenData.user_id
      };

      const save = await fetch(recordUrl.toString(), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": etag
        },
        body: JSON.stringify(record)
      });

      if (save.status === 412) continue;
      if (!save.ok) throw new Error("Image generation record could not be saved");
      savedRecord = record;
      break;
    }

    if (!savedRecord) {
      return respond(
        { success: false, error: "Could not allocate a unique Image ID. Please retry." },
        503
      );
    }

    return respond({ success: true, imageGeneration: savedRecord }, 201);

  } catch (error) {
    console.error("IMAGE_GENERATION_RECORD_ERROR:", error?.message || String(error));
    return Response.json(
      { success: false, error: "Image generation record could not be saved" },
      { status: 503, headers }
    );
  }
}

    return Response.json({
      success: false,
      error: "Route not found"
    }, { status: 404, headers });
  }
};
