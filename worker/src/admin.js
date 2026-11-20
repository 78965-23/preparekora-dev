import {
  generateCloudinarySignature,
  createAuthenticatedDeliveryUrl
} from "./cloudinary.js";

const DEFAULT_SUBJECTS = [
  { code: "GK", name: "General Knowledge", active: true },
  { code: "SS", name: "Social Studies", active: true },
  { code: "ENG", name: "English", active: true },
  { code: "MATH", name: "Mathematics", active: true },
  { code: "LR", name: "Logical Reasoning", active: true },
  { code: "CK", name: "Computer Knowledge", active: true }
];

const DEFAULT_EXAMS = [
  { code: "MOCK", name: "Mock Test", active: true }
];

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp"
];

/* ---------------------------------------------------------
   RESPONSE HELPERS
--------------------------------------------------------- */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function errorResponse(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

function decodePathValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/* ---------------------------------------------------------
   FIREBASE REALTIME DATABASE HELPERS

   Uses the authenticated Firebase ID token.
   Firebase Security Rules must authorize the Admin UID.
--------------------------------------------------------- */

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

function databaseUrl(env, token, path = "") {
  const base = String(env.FIREBASE_DATABASE_URL || "")
    .replace(/\/+$/, "");

  if (!base) {
    throw new Error("Firebase database URL is missing.");
  }

  const safePath = path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");

  const url = new URL(
    `${base}/${safePath ? safePath + "/" : ""}.json`
  );

  url.searchParams.set("auth", token);

  return url;
}

async function databaseRequest(
  env,
  token,
  path,
  method = "GET",
  body
) {
  const options = {
    method,
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  };

  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(
    databaseUrl(env, token, path),
    options
  );

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    console.error(
      "Firebase database operation failed:",
      response.status
    );

    throw new Error(
      "Firebase database operation failed. Check database rules and configuration."
    );
  }

  return result;
}

function getToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    throw new Error("Authentication token is missing.");
  }

  return match[1].trim();
}

async function getSets(env, token) {
  const data = await databaseRequest(
    env,
    token,
    "sets"
  );

  if (!data || typeof data !== "object") {
    return [];
  }

  return Object.values(data)
    .filter(item => item && typeof item === "object")
    .map(item => item);
}

async function getSet(env, token, setId) {
  return databaseRequest(
    env,
    token,
    `sets/${encodeKey(setId)}`
  );
}

async function saveSet(env, token, set) {
  await databaseRequest(
    env,
    token,
    `sets/${encodeKey(set.id)}`,
    "PUT",
    set
  );
}

async function addActivity(env, token, type, message, uid) {
  await databaseRequest(
    env,
    token,
    "activities",
    "POST",
    {
      type,
      message,
      timestamp: Date.now(),
      uid
    }
  );
}

function normalizeCatalog(data) {
  if (Array.isArray(data)) {
    return data.filter(Boolean);
  }

  if (!data || typeof data !== "object") {
    return [];
  }

  return Object.entries(data).map(([key, value]) => {
    if (typeof value === "string") {
      return {
        code: key,
        name: value,
        active: true
      };
    }

    return {
      ...value,
      code: value.code || key
    };
  });
}

/* ---------------------------------------------------------
   ATOMIC SET ID COUNTER
--------------------------------------------------------- */

async function nextSequence(env, token, counterKey) {
  const url = databaseUrl(
    env,
    token,
    `sequenceCounters/${encodeKey(counterKey)}`
  );

  for (let attempt = 0; attempt < 8; attempt++) {
    const currentResponse = await fetch(url, {
      method: "GET",
      headers: {
        "X-Firebase-ETag": "true"
      },
      cache: "no-store"
    });

    if (!currentResponse.ok) {
      throw new Error("Unable to read Set ID sequence.");
    }

    const current = Number(
      await currentResponse.json()
    ) || 0;

    const etag = currentResponse.headers.get("ETag");

    if (!etag) {
      throw new Error("Set ID sequence could not be verified.");
    }

    const next = current + 1;

    const updateResponse = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "if-match": etag
      },
      body: JSON.stringify(next)
    });

    if (updateResponse.status === 412) {
      continue;
    }

    if (!updateResponse.ok) {
      throw new Error("Unable to allocate the next Set ID.");
    }

    return next;
  }

  throw new Error(
    "Set ID allocation failed. Please retry."
  );
}

function getMonthYear() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    month: "2-digit",
    year: "2-digit"
  }).formatToParts(new Date());

  const month = parts.find(item => item.type === "month")?.value;
  const year = parts.find(item => item.type === "year")?.value;

  return { month, year };
}

function validateCode(value, label) {
  const code = String(value || "")
    .trim()
    .toUpperCase();

  if (!/^[A-Z0-9_-]{2,24}$/.test(code)) {
    throw new Error(`${label} code is invalid.`);
  }

  return code;
}

/* ---------------------------------------------------------
   MCQ VALIDATION
--------------------------------------------------------- */

function validateDraft(draft) {
  if (!draft || typeof draft !== "object") {
    throw new Error("MCQ draft is missing.");
  }

  const examCode = validateCode(
    draft.examCode,
    "Examination"
  );

  const subjectCode = validateCode(
    draft.subjectCode,
    "Subject"
  );

  if (!Array.isArray(draft.questions) ||
      draft.questions.length !== 5) {
    throw new Error("Exactly five questions are required.");
  }

  const questions = draft.questions.map((question, index) => {
    const number = index + 1;

    if (!question || typeof question !== "object") {
      throw new Error(`Question ${number} is invalid.`);
    }

    const questionText = String(
      question.question || ""
    ).trim();

    if (!questionText) {
      throw new Error(`Question ${number} is empty.`);
    }

    if (!Array.isArray(question.options) ||
        question.options.length !== 4) {
      throw new Error(
        `Question ${number} must have four options.`
      );
    }

    const options = question.options.map((option, optionIndex) => {
      const expectedLetter = ["A", "B", "C", "D"][optionIndex];

      if (
        !option ||
        option.letter !== expectedLetter ||
        !String(option.text || "").trim()
      ) {
        throw new Error(
          `Question ${number}: Option ${expectedLetter} is invalid.`
        );
      }

      return {
        letter: expectedLetter,
        text: String(option.text),
        english: String(option.english || ""),
        assamese: String(option.assamese || "")
      };
    });

    const answer = String(question.answer || "")
      .toUpperCase();

    if (!["A", "B", "C", "D"].includes(answer)) {
      throw new Error(
        `Question ${number} has an invalid answer.`
      );
    }

    return {
      number,
      id: `Q${number}`,
      question: questionText,
      english: String(question.english || ""),
      assamese: String(question.assamese || ""),
      options,
      answer,
      correctIndex: ["A", "B", "C", "D"].indexOf(answer),
      explanation: String(question.explanation || "")
    };
  });

  return {
    examCode,
    subjectCode,
    language: String(draft.language || "bilingual"),
    questions
  };
}

/* ---------------------------------------------------------
   CREATE MCQ SET
--------------------------------------------------------- */

async function createSet(request, env, token, uid) {
  const body = await request.json();
  const draft = validateDraft(body.draft);

  const idempotencyKey =
    request.headers.get("Idempotency-Key") || "";

  if (!idempotencyKey || idempotencyKey.length > 200) {
    return errorResponse("A valid idempotency key is required.");
  }

  const idempotencyPath =
    `idempotency/${encodeKey(idempotencyKey)}`;

  const previous = await databaseRequest(
    env,
    token,
    idempotencyPath
  );

  if (previous?.setId) {
    return json({
      ok: true,
      setId: previous.setId,
      existing: true
    });
  }

  const { month, year } = getMonthYear();

  const counterKey = [
    draft.examCode,
    draft.subjectCode,
    month,
    year
  ].join("_");

  const sequence = await nextSequence(
    env,
    token,
    counterKey
  );

  const setId = [
    "PREPAREKORA",
    draft.examCode,
    draft.subjectCode,
    month,
    year,
    String(sequence).padStart(4, "0")
  ].join("/");

  const now = Date.now();

  const set = {
    id: setId,
    exam: draft.examCode,
    subject: draft.subjectCode,
    examCode: draft.examCode,
    subjectCode: draft.subjectCode,
    language: draft.language,
    questions: draft.questions,
    status: "generating",
    createdAt: now,
    postedAt: null,
    revealedAt: null,
    revealAt: null,
    assets: {},
    createdBy: uid
  };

  await saveSet(env, token, set);

  await databaseRequest(
    env,
    token,
    idempotencyPath,
    "PUT",
    { setId, createdAt: now }
  );

  await addActivity(
    env,
    token,
    "set-created",
    `Created MCQ set ${setId}`,
    uid
  );

  return json({
    ok: true,
    setId
  });
}

/* ---------------------------------------------------------
   CLOUDINARY IMAGE UPLOAD
--------------------------------------------------------- */

async function uploadAsset(request, env, token, uid) {
  const form = await request.formData();

  const file = form.get("file");
  const setId = String(form.get("setId") || "");
  const questionId = String(form.get("questionId") || "");
  const imageMode = String(form.get("imageMode") || "");

  if (!file || typeof file.arrayBuffer !== "function") {
    return errorResponse("Image file is missing.");
  }

  if (!setId || !["teaser", "answer"].includes(imageMode)) {
    return errorResponse("Invalid image upload details.");
  }

  if (
    file.size < 1 ||
    file.size > MAX_IMAGE_BYTES ||
    !ALLOWED_IMAGE_TYPES.includes(file.type)
  ) {
    return errorResponse(
      "Image must be PNG, JPG or WEBP and no larger than 20 MB."
    );
  }

  const match = questionId.match(/-Q([1-5])$/);

  if (!match || questionId !== `${setId}-Q${match[1]}`) {
    return errorResponse("Invalid question ID.");
  }

  const questionNumber = Number(match[1]);

  const set = await getSet(env, token, setId);

  if (!set || set.status !== "generating") {
    return errorResponse(
      "The MCQ set is not available for image uploads.",
      404
    );
  }

  const signatureData =
    await generateCloudinarySignature(env);

  const uploadForm = new FormData();

  uploadForm.append("file", file, file.name || `Q${questionNumber}.png`);
  uploadForm.append("api_key", signatureData.apiKey);
  uploadForm.append("timestamp", String(signatureData.timestamp));
  uploadForm.append("upload_preset", signatureData.uploadPreset);
  uploadForm.append("signature", signatureData.signature);

  // Teaser images are public for publishing.
  // Answer images use authenticated delivery.
  const uploadPath = imageMode === "answer"
    ? "image/authenticated/upload"
    : "image/upload";

  const cloudinaryUrl =
    `https://api.cloudinary.com/v1_1/` +
    `${signatureData.cloudName}/${uploadPath}`;

  const uploadResponse = await fetch(cloudinaryUrl, {
    method: "POST",
    body: uploadForm
  });

  const uploaded = await uploadResponse.json().catch(() => null);

  if (!uploadResponse.ok || !uploaded?.public_id) {
    console.error(
      "Cloudinary upload failed:",
      uploadResponse.status,
      uploaded?.error?.message || "Unknown error"
    );

    throw new Error("Cloudinary image upload failed.");
  }

  const asset = {
    publicId: uploaded.public_id,
    version: Number(uploaded.version),
    format: uploaded.format,
    bytes: Number(uploaded.bytes || file.size),
    imageMode,
    questionNumber,
    deliveryType: imageMode === "answer"
      ? "authenticated"
      : "upload",
    uploadedAt: Date.now()
  };

  if (imageMode === "teaser") {
    asset.secureUrl = uploaded.secure_url;
  }

  set.assets = set.assets || {};
  set.assets[String(questionNumber)] =
    set.assets[String(questionNumber)] || {};

  set.assets[String(questionNumber)][imageMode] = asset;

  await saveSet(env, token, set);

  await addActivity(
    env,
    token,
    "asset-uploaded",
    `Uploaded ${imageMode} image for ${setId}, Q${questionNumber}`,
    uid
  );

  return json({
    ok: true,
    asset
  });
}

/* ---------------------------------------------------------
   COMPLETE IMAGE GENERATION
--------------------------------------------------------- */

async function completeGeneration(env, token, setId, uid) {
  const set = await getSet(env, token, setId);

  if (!set) {
    return errorResponse("MCQ set was not found.", 404);
  }

  let imageCount = 0;

  for (let number = 1; number <= 5; number++) {
    const assets = set.assets?.[String(number)];

    if (!assets?.teaser || !assets?.answer) {
      return errorResponse(
        `Images are incomplete for question ${number}.`
      );
    }

    imageCount += 2;
  }

  if (imageCount !== 10) {
    return errorResponse("All ten images are required.");
  }

  set.status = "ready";
  set.generatedAt = Date.now();
  set.imageCount = imageCount;

  await saveSet(env, token, set);

  await addActivity(
    env,
    token,
    "generation-completed",
    `Completed ten images for ${setId}`,
    uid
  );

  return json({
    ok: true,
    setId,
    imageCount
  });
}

/* ---------------------------------------------------------
   MARK SET AS POSTED
--------------------------------------------------------- */

async function markPosted(request, env, token, setId, uid) {
  const set = await getSet(env, token, setId);

  if (!set || set.status !== "ready") {
    return errorResponse(
      "Only completed MCQ sets can be marked as posted.",
      404
    );
  }

  if (set.postedAt) {
    return errorResponse("This set is already marked as posted.");
  }

  const body = await request.json().catch(() => ({}));
  const postUrl = String(body.postUrl || "").trim();

  if (postUrl) {
    try {
      const parsed = new URL(postUrl);

      if (
        parsed.protocol !== "https:" ||
        !["instagram.com", "www.instagram.com"].includes(parsed.hostname)
      ) {
        return errorResponse("Enter a valid Instagram HTTPS URL.");
      }
    } catch {
      return errorResponse("The post URL is invalid.");
    }
  }

  const now = Date.now();

  const configuredDelay = Number(
    env.REVEAL_DELAY_HOURS || 6
  );

  set.postedAt = now;
  set.postUrl = postUrl;
  set.revealAt =
    now + Math.max(1, configuredDelay) * 60 * 60 * 1000;

  await saveSet(env, token, set);

  await addActivity(
    env,
    token,
    "set-posted",
    `Marked ${setId} as posted`,
    uid
  );

  return json({
    ok: true,
    setId,
    postedAt: now,
    revealAt: set.revealAt
  });
}

/* ---------------------------------------------------------
   MANUAL ANSWER REVEAL
--------------------------------------------------------- */

async function revealSet(env, token, setId, uid) {
  const set = await getSet(env, token, setId);

  if (!set || !set.postedAt) {
    return errorResponse(
      "The set must be posted before revealing answers.",
      404
    );
  }

  if (set.revealedAt) {
    return errorResponse("Answers are already revealed.");
  }

  const now = Date.now();

  set.revealedAt = now;
  set.revealAt = null;

  await saveSet(env, token, set);

  await addActivity(
    env,
    token,
    "answers-revealed",
    `Revealed answers for ${setId}`,
    uid
  );

  return json({
    ok: true,
    setId,
    revealedAt: now
  });
}

/* ---------------------------------------------------------
   AUTHENTICATED ANSWER IMAGE
--------------------------------------------------------- */

async function getAnswerImage(env, token, setId, questionNumber) {
  const set = await getSet(env, token, setId);

  if (!set || !set.revealedAt) {
    return errorResponse(
      "Answer images are not available yet.",
      403
    );
  }

  const asset =
    set.assets?.[String(questionNumber)]?.answer;

  if (
    !asset ||
    asset.deliveryType !== "authenticated"
  ) {
    return errorResponse(
      "Answer image was not found.",
      404
    );
  }

  const secureUrl = await createAuthenticatedDeliveryUrl(
    env,
    asset
  );

  const imageResponse = await fetch(secureUrl, {
    method: "GET",
    cache: "no-store"
  });

  if (!imageResponse.ok) {
    console.error(
      "Authenticated Cloudinary image request failed:",
      imageResponse.status
    );

    return errorResponse(
      "Unable to retrieve the answer image.",
      502
    );
  }

  return new Response(imageResponse.body, {
    status: 200,
    headers: {
      "Content-Type": imageResponse.headers.get("Content-Type") || "image/png",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

/* ---------------------------------------------------------
   ADMIN API ROUTER
--------------------------------------------------------- */

export async function handleAdminRequest(
  request,
  env,
  ctx,
  uid
) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  const token = getToken(request);

  try {
    if (path === "/api/admin/dashboard" && method === "GET") {
      const [sets, activityData] = await Promise.all([
        getSets(env, token),
        databaseRequest(env, token, "activities")
      ]);

      const activities = normalizeCatalog(activityData)
        .sort((a, b) =>
          Number(b.timestamp || 0) - Number(a.timestamp || 0)
        )
        .slice(0, 20);

      return json({
        ok: true,
        stats: {
          totalSets: sets.length,
          totalQuestions: sets.reduce(
            (total, set) => total + (set.questions?.length || 0),
            0
          ),
          postedSets: sets.filter(set => Boolean(set.postedAt)).length,
          pendingReveals: sets.filter(
            set => set.postedAt && !set.revealedAt
          ).length
        },
        activities
      });
    }

    if (path === "/api/admin/exams" && method === "GET") {
      const data = await databaseRequest(env, token, "exams");
      const exams = normalizeCatalog(data);

      return json({
        ok: true,
        exams: exams.length ? exams : DEFAULT_EXAMS
      });
    }

    if (path === "/api/admin/subjects" && method === "GET") {
      const data = await databaseRequest(env, token, "subjects");
      const subjects = normalizeCatalog(data);

      return json({
        ok: true,
        subjects: subjects.length ? subjects : DEFAULT_SUBJECTS
      });
    }

    if (path === "/api/admin/sets" && method === "GET") {
      const sets = await getSets(env, token);

      sets.sort((a, b) =>
        Number(b.createdAt || 0) - Number(a.createdAt || 0)
      );

      return json({ ok: true, sets });
    }

    if (path === "/api/admin/sets" && method === "POST") {
      return await createSet(request, env, token, uid);
    }

    if (path === "/api/admin/assets" && method === "POST") {
      return await uploadAsset(request, env, token, uid);
    }

    if (path === "/api/admin/history" && method === "GET") {
      const history = await getSets(env, token);

      history.sort((a, b) =>
        Number(b.createdAt || 0) - Number(a.createdAt || 0)
      );

      return json({ ok: true, history });
    }

    if (path === "/api/admin/reveals" && method === "GET") {
      const sets = await getSets(env, token);

      return json({
        ok: true,
        sets: sets.filter(set =>
          set.status === "ready" &&
          set.postedAt &&
          !set.revealedAt
        )
      });
    }

    if (path === "/api/admin/activities" && method === "GET") {
      const data = await databaseRequest(env, token, "activities");

      const activities = normalizeCatalog(data)
        .sort((a, b) =>
          Number(b.timestamp || 0) - Number(a.timestamp || 0)
        );

      return json({ ok: true, activities });
    }

    if (path === "/api/admin/settings" && method === "GET") {
      const data = await databaseRequest(env, token, "settings");

      const settings = {
        revealDelayHours: Number(
          data?.revealDelayHours ??
          env.REVEAL_DELAY_HOURS ??
          6
        )
      };

      return json({ ok: true, settings });
    }

    const answerMatch = path.match(
      /^\/api\/admin\/sets\/([^/]+)\/answers\/([1-5])$/
    );

    if (answerMatch && method === "GET") {
      return await getAnswerImage(
        env,
        token,
        decodePathValue(answerMatch[1]),
        Number(answerMatch[2])
      );
    }

    const completeMatch = path.match(
      /^\/api\/admin\/sets\/([^/]+)\/complete-generation$/
    );

    if (completeMatch && method === "POST") {
      return await completeGeneration(
        env,
        token,
        decodePathValue(completeMatch[1]),
        uid
      );
    }

    const postedMatch = path.match(
      /^\/api\/admin\/sets\/([^/]+)\/posted$/
    );

    if (postedMatch && method === "POST") {
      return await markPosted(
        request,
        env,
        token,
        decodePathValue(postedMatch[1]),
        uid
      );
    }

    const revealMatch = path.match(
      /^\/api\/admin\/sets\/([^/]+)\/reveal$/
    );

    if (revealMatch && method === "POST") {
      return await revealSet(
        env,
        token,
        decodePathValue(revealMatch[1]),
        uid
      );
    }

    return errorResponse("Admin API route not found.", 404);

  } catch (error) {
    console.error("Admin operation failed:", error);

    return errorResponse(
      error.message || "Admin operation failed.",
      500
    );
  }
}
