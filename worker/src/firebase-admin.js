
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/firebase.database"
].join(" ");

let cachedToken = "";
let cachedExpiry = 0;
let cachedEmail = "";

function base64UrlEncode(value) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : new Uint8Array(value);

  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodePrivateKey(pem) {
  const cleaned = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

async function createSignedAssertion(email, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);

  const header = base64UrlEncode(
    JSON.stringify({
      alg: "RS256",
      typ: "JWT"
    })
  );

  const payload = base64UrlEncode(
    JSON.stringify({
      iss: email,
      scope: SCOPES,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600
    })
  );

  const unsignedToken = `${header}.${payload}`;

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    decodePrivateKey(privateKeyPem),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

export async function getFirebaseAdminToken(env) {
  const email = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = env.FIREBASE_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw new Error(
      "Firebase service-account configuration is missing."
    );
  }

  if (
    cachedToken &&
    cachedEmail === email &&
    Date.now() < cachedExpiry - 60000
  ) {
    return cachedToken;
  }

  const assertion = await createSignedAssertion(
    email,
    privateKey
  );

  const form = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.access_token) {
    console.error(
      "Firebase service-account authentication failed:",
      response.status
    );

    throw new Error(
      "Unable to authenticate with Firebase."
    );
  }

  cachedToken = result.access_token;
  cachedEmail = email;
  cachedExpiry =
    Date.now() + Number(result.expires_in || 3600) * 1000;

  return cachedToken;
}

export async function firebaseAdminRequest(
  env,
  path,
  method = "GET",
  body
) {
  const base = String(env.FIREBASE_DATABASE_URL || "")
    .replace(/\/+$/, "");

  if (!base) {
    throw new Error("Firebase database URL is missing.");
  }

  const safePath = String(path || "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");

  const url = `${base}/${safePath ? safePath + "/" : ""}.json`;
  const token = await getFirebaseAdminToken(env);

  const options = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    },
    cache: "no-store"
  };

  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    console.error(
      "Firebase Admin database request failed:",
      response.status
    );

    throw new Error(
      "Firebase database request failed."
    );
  }

  return result;
}
