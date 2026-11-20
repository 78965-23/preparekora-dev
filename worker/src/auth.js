export async function verifyAdminToken(request, env) {
  try {
    const authorization = request.headers.get("Authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (!match || !env.FIREBASE_WEB_API_KEY || !env.ADMIN_UID) {
      return null;
    }

    const idToken = match[1].trim();

    if (!idToken) {
      return null;
    }

    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ idToken })
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const user = data.users?.[0];

    if (!user || user.localId !== env.ADMIN_UID) {
      return null;
    }

    return {
      ok: true,
      uid: user.localId
    };
  } catch (error) {
    console.error("Admin token verification failed.");
    return null;
  }
}
