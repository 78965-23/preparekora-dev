import {
  firebaseAdminRequest
} from "./firebase-admin.js";

import {
  createAuthenticatedDeliveryUrl
} from "./cloudinary.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function encodeKey(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function getSet(env, setId) {
  return firebaseAdminRequest(
    env,
    `sets/${encodeKey(setId)}`
  );
}

function publicQuestion(question, revealed) {
  const result = {
    number: question.number,
    id: question.id,
    question: question.question,
    english: question.english,
    assamese: question.assamese,

    options: (question.options || []).map(option => ({
      letter: option.letter,
      text: option.text,
      english: option.english,
      assamese: option.assamese
    }))
  };

  if (revealed) {
    result.answer = question.answer;
    result.correctIndex = question.correctIndex;
    result.explanation = question.explanation || "";
  }

  return result;
}

async function getPublicSet(request, env, setId) {
  const set = await getSet(env, setId);

  if (!set) {
    return json({
      ok: false,
      error: "MCQ set not found."
    }, 404);
  }

  if (set.status !== "ready" || !set.postedAt) {
    return json({
      ok: false,
      error: "This MCQ set is not published yet."
    }, 404);
  }

  const revealed = Boolean(set.revealedAt);

  const questions = (set.questions || []).map(question =>
    publicQuestion(question, revealed)
  );

  const assets = {};

  for (let number = 1; number <= 5; number++) {
    const item = set.assets?.[String(number)] || {};

    assets[String(number)] = {
      teaserUrl: item.teaser?.secureUrl || "",
      answerImageUrl: revealed
        ? `${new URL(request.url).origin}/api/reveal/${encodeURIComponent(setId)}/answers/${number}`
        : null
    };
  }

  return json({
    ok: true,
    setId: set.id,
    exam: set.exam,
    subject: set.subject,
    language: set.language,
    createdAt: set.createdAt,
    postedAt: set.postedAt,
    revealAt: set.revealAt || null,
    revealedAt: set.revealedAt || null,
    revealed,
    questions,
    assets
  });
}

async function getPublicAnswerImage(env, setId, questionNumber) {
  const set = await getSet(env, setId);

  if (!set || !set.revealedAt) {
    return json({
      ok: false,
      error: "Answers have not been revealed."
    }, 403);
  }

  const asset =
    set.assets?.[String(questionNumber)]?.answer;

  if (
    !asset ||
    asset.deliveryType !== "authenticated"
  ) {
    return json({
      ok: false,
      error: "Answer image not found."
    }, 404);
  }

  const secureUrl = await createAuthenticatedDeliveryUrl(
    env,
    asset
  );

  const response = await fetch(secureUrl, {
    method: "GET",
    redirect: "follow",
    cache: "no-store"
  });

  if (!response.ok) {
    console.error(
      "Cloudinary answer-image request failed:",
      response.status
    );

    return json({
      ok: false,
      error: "Unable to retrieve answer image."
    }, 502);
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type":
        response.headers.get("Content-Type") || "image/png",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function handleRevealRequest(request, env, ctx) {
  if (request.method !== "GET") {
    return json({
      ok: false,
      error: "Method not allowed."
    }, 405);
  }

  const path = new URL(request.url).pathname;

  try {
    const imageMatch = path.match(
      /^\/api\/reveal\/(.+)\/answers\/([1-5])$/
    );

    if (imageMatch) {
      const setId = decodeValue(imageMatch[1]);
      const questionNumber = Number(imageMatch[2]);

      return await getPublicAnswerImage(
        env,
        setId,
        questionNumber
      );
    }

    let setId = "";

    if (path === "/api/reveal") {
      setId = new URL(request.url).searchParams.get("setId") || "";
    } else if (path.startsWith("/api/reveal/")) {
      setId = decodeValue(
        path.slice("/api/reveal/".length)
      );
    }

    if (!setId || setId.length > 200) {
      return json({
        ok: false,
        error: "A valid Set ID is required."
      }, 400);
    }

    return await getPublicSet(
      request,
      env,
      setId
    );

  } catch (error) {
    console.error("Public reveal request failed:", error);

    return json({
      ok: false,
      error: "Unable to load MCQ results."
    }, 500);
  }
}
