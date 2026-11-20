
/* =========================================================
   PREPAREKORA — SINGLE FRONTEND APPLICATION
   Login + Dashboard + Management + MCQ Studio
   Firebase Authentication + Cloudflare Worker + Cloudinary
========================================================= */

"use strict";

/* =========================================================
   1. APPLICATION CONFIGURATION
========================================================= */

const PK_CONFIG = Object.freeze({
  API_BASE:
    "https://preparekora-dev-api.YOUR_SUBDOMAIN.workers.dev",

  QUESTION_COUNT: 5,
  IMAGE_COUNT: 10,
  PAGE_SIZE: 5,
  DEFAULT_REVEAL_HOURS: 6,
  TIME_ZONE: "Asia/Kolkata",

  IMAGE_TYPES: ["teaser", "answer"],

  RATIOS: {
    "1:1": [1080, 1080],
    "16:9": [1920, 1080],
    "4:3": [1440, 1080],
    "9:16": [1080, 1920]
  },

  MAX_IMAGE_BYTES: 20 * 1024 * 1024,
  MAX_IMAGE_PIXELS: 35000000,
  MAX_IMAGE_DIMENSION: 16000
});

/* =========================================================
   2. APPLICATION STATE
========================================================= */

const PK_STATE = {
  firebase: null,
  auth: null,
  adminUid: null,
  user: null,

  initialized: false,
  initializationPromise: null,

  sets: [],
  filteredSets: [],
  history: [],
  filteredHistory: [],
  subjects: [],
  exams: [],

  setsPage: 1,
  historyPage: 1,

  studio: {
    questions: [],
    currentQuestion: 0,
    imageMode: "teaser",
    setId: null,
    idempotencyKey: null,
    generationRunning: false,
    uploadedAssets: {},
    valid: false,
    lastContent: ""
  },

  objectUrls: [],
  revealLoading: false
};

/* =========================================================
   3. DOM HELPERS
========================================================= */

const PK = {
  $: id => document.getElementById(id),

  all: selector =>
    Array.from(document.querySelectorAll(selector)),

  text(id, value) {
    const element = this.$(id);
    if (element) element.textContent = String(value ?? "");
  },

  show(element) {
    if (typeof element === "string") {
      element = this.$(element);
    }

    if (element) element.hidden = false;
  },

  hide(element) {
    if (typeof element === "string") {
      element = this.$(element);
    }

    if (element) element.hidden = true;
  },

  create(tag, className = "", text = undefined) {
    const element = document.createElement(tag);

    if (className) element.className = className;

    if (text !== undefined && text !== null) {
      element.textContent = String(text);
    }

    return element;
  },

  status(id, message) {
    this.text(id, message);
  },

  async wait(ms = 0) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  nextFrame() {
    return new Promise(resolve =>
      requestAnimationFrame(() => resolve())
    );
  },

  formatDate(timestamp) {
    if (!timestamp) return "—";

    const date = new Date(Number(timestamp));

    if (Number.isNaN(date.getTime())) return "—";

    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: PK_CONFIG.TIME_ZONE
    }).format(date);
  },

  escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[character]
    );
  },

  revokeObjectUrls() {
    for (const url of PK_STATE.objectUrls) {
      URL.revokeObjectURL(url);
    }

    PK_STATE.objectUrls = [];
  }
};

/* =========================================================
   4. FIREBASE INITIALIZATION
   Configuration is retrieved from the Cloudflare Worker.
========================================================= */

async function initializeFirebase() {
  if (PK_STATE.firebase) {
    return PK_STATE.firebase;
  }

  if (PK_STATE.initializationPromise) {
    return PK_STATE.initializationPromise;
  }

  PK_STATE.initializationPromise = (async () => {
    const response = await fetch(
      `${PK_CONFIG.API_BASE}/api/public-config`,
      {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        "Unable to load Firebase configuration from Worker. Check Worker deployment."
      );
    }

    const result = await response.json();

    if (
      !result.ok ||
      !result.firebaseConfig ||
      !result.adminUid
    ) {
      throw new Error(
        "Firebase configuration is incomplete."
      );
    }

    const [appModule, authModule] = await Promise.all([
      import(
        "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js"
      ),
      import(
        "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js"
      )
    ]);

    const firebaseApp = appModule.initializeApp(
      result.firebaseConfig
    );

    const auth = authModule.getAuth(firebaseApp);

    await authModule.setPersistence(
      auth,
      authModule.browserLocalPersistence
    );

    PK_STATE.firebase = {
      app: firebaseApp,
      authModule,
      appModule
    };

    PK_STATE.auth = auth;
    PK_STATE.adminUid = result.adminUid;

    const firebaseAPI = {
      app: firebaseApp,
      auth,
      ADMIN_UID: result.adminUid,

      signIn(email, password) {
        return authModule.signInWithEmailAndPassword(
          auth,
          email,
          password
        );
      },

      signOut() {
        return authModule.signOut(auth);
      },

      resetPassword(email) {
        return authModule.sendPasswordResetEmail(
          auth,
          email
        );
      },

      getIdToken() {
        if (!auth.currentUser) {
          return Promise.reject(
            new Error("User is not authenticated.")
          );
        }

        return authModule.getIdToken(
          auth.currentUser
        );
      },

      onAuthStateChanged(callback) {
        return authModule.onAuthStateChanged(
          auth,
          callback
        );
      }
    };

    window.PreparekoraFirebase = firebaseAPI;

    return firebaseAPI;
  })();

  try {
    return await PK_STATE.initializationPromise;
  } catch (error) {
    PK_STATE.initializationPromise = null;
    throw error;
  }
}

/* =========================================================
   5. API CLIENT
========================================================= */

async function apiRequest(path, options = {}) {
  const firebase = window.PreparekoraFirebase;

  if (!firebase) {
    throw new Error("Firebase is not initialized.");
  }

  const token = await firebase.getIdToken();

  const isFormData = options.body instanceof FormData;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(options.headers || {})
  };

  if (
    !isFormData &&
    options.body !== undefined
  ) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(
    `${PK_CONFIG.API_BASE}${path}`,
    {
      method: options.method || "GET",
      headers,
      body: isFormData
        ? options.body
        : options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
      cache: "no-store"
    }
  );

  if (!response.ok) {
    let message = "API request failed.";

    try {
      const result = await response.json();
      message = result.error || message;
    } catch {
      // Preserve default error.
    }

    const error = new Error(message);
    error.status = response.status;

    throw error;
  }

  if (options.responseType === "blob") {
    return response.blob();
  }

  return response.json();
}

const API = {
  getDashboard() {
    return apiRequest("/api/admin/dashboard");
  },

  getExams() {
    return apiRequest("/api/admin/exams");
  },

  getSubjects() {
    return apiRequest("/api/admin/subjects");
  },

  getSets() {
    return apiRequest("/api/admin/sets");
  },

  getHistory() {
    return apiRequest("/api/admin/history");
  },

  getReveals() {
    return apiRequest("/api/admin/reveals");
  },

  getActivities() {
    return apiRequest("/api/admin/activities");
  },

  getSettings() {
    return apiRequest("/api/admin/settings");
  },

  createSet(draft, idempotencyKey) {
    return apiRequest("/api/admin/sets", {
      method: "POST",
      headers: {
        "Idempotency-Key": idempotencyKey
      },
      body: { draft }
    });
  },

  uploadAsset(asset) {
    const form = new FormData();

    form.append(
      "file",
      asset.blob,
      asset.fileName
    );

    form.append("setId", asset.setId);
    form.append("questionId", asset.questionId);
    form.append("imageMode", asset.imageMode);

    return apiRequest("/api/admin/assets", {
      method: "POST",
      body: form
    });
  },

  completeGeneration(setId) {
    return apiRequest(
      `/api/admin/sets/${encodeURIComponent(setId)}/complete-generation`,
      {
        method: "POST",
        body: {}
      }
    );
  },

  markPosted(setId, postUrl = "") {
    return apiRequest(
      `/api/admin/sets/${encodeURIComponent(setId)}/posted`,
      {
        method: "POST",
        body: { postUrl }
      }
    );
  },

  revealSet(setId) {
    return apiRequest(
      `/api/admin/sets/${encodeURIComponent(setId)}/reveal`,
      {
        method: "POST",
        body: {}
      }
    );
  },

  getAnswerImage(setId, questionNumber) {
    const number = Number(questionNumber);

    if (
      !Number.isInteger(number) ||
      number < 1 ||
      number > 5
    ) {
      throw new Error("Invalid question number.");
    }

    return apiRequest(
      `/api/admin/sets/${encodeURIComponent(setId)}/answers/${number}`,
      {
        responseType: "blob"
      }
    );
  }
};

window.PreparekoraAPI = API;

/* =========================================================
   6. AUTHENTICATION — LOGIN PAGE
========================================================= */

async function initializeLoginPage() {
  const form = PK.$("loginForm");

  if (!form) return;

  const emailInput = PK.$("loginEmail");
  const passwordInput = PK.$("loginPassword");
  const loginButton = PK.$("loginButton");
  const status = PK.$("authStatus");

  const setLoginStatus = message => {
    if (status) status.textContent = message;
  };

  const firebase = await initializeFirebase();

  firebase.onAuthStateChanged(async user => {
    if (!user) return;

    if (user.uid === firebase.ADMIN_UID) {
      window.location.replace("admin.html#dashboard");
      return;
    }

    await firebase.signOut().catch(() => {});

    setLoginStatus(
      "This account does not have administrator access."
    );
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      setLoginStatus(
        "Enter your email address and password."
      );
      return;
    }

    loginButton.disabled = true;
    setLoginStatus("Signing in...");

    try {
      const credential = await firebase.signIn(
        email,
        password
      );

      if (
        credential.user.uid !== firebase.ADMIN_UID
      ) {
        await firebase.signOut();

        throw new Error(
          "This account is not authorized as administrator."
        );
      }

      setLoginStatus("Login successful.");

      window.location.replace("admin.html#dashboard");

    } catch (error) {
      setLoginStatus(
        error.message ||
        "Unable to sign in. Check your credentials."
      );

      loginButton.disabled = false;
    }
  });

  const toggle = PK.$("togglePassword");

  if (toggle) {
    toggle.addEventListener("click", () => {
      const visible = passwordInput.type === "text";

      passwordInput.type = visible ? "password" : "text";

      toggle.setAttribute(
        "aria-label",
        visible ? "Show password" : "Hide password"
      );

      toggle.setAttribute(
        "aria-pressed",
        String(!visible)
      );
    });
  }

  const forgot = PK.$("forgotPasswordButton");

  if (forgot) {
    forgot.addEventListener("click", async () => {
      const email = emailInput.value.trim();

      if (!email) {
        setLoginStatus(
          "Enter your email address first."
        );
        emailInput.focus();
        return;
      }

      forgot.disabled = true;
      setLoginStatus("Sending password reset email...");

      try {
        await firebase.resetPassword(email);

        setLoginStatus(
          "Password reset email sent. Check your inbox."
        );

      } catch (error) {
        setLoginStatus(
          error.message || "Unable to send reset email."
        );

      } finally {
        forgot.disabled = false;
      }
    });
  }
}

/* =========================================================
   7. COMMON AUTHENTICATION GUARD
========================================================= */

async function requireAdmin() {
  const firebase = await initializeFirebase();

  return new Promise((resolve, reject) => {
    let firstCheck = true;

    const unsubscribe = firebase.onAuthStateChanged(
      async user => {
        if (!firstCheck) return;
        firstCheck = false;

        if (
          !user ||
          user.uid !== firebase.ADMIN_UID
        ) {
          await firebase.signOut().catch(() => {});

          window.location.replace("index.html");
          resolve(false);
          return;
        }

        PK_STATE.user = user;

        PK.text("adminEmail", user.email || "Administrator");

        resolve(true);
      }
    );

    // Keep the listener alive only for this page session.
    PK_STATE.authUnsubscribe = unsubscribe;
  });
}

async function signOutAdmin() {
  try {
    const firebase = window.PreparekoraFirebase;

    if (firebase) {
      await firebase.signOut();
    }

    window.location.replace("index.html");

  } catch (error) {
    alert("Unable to sign out. Please try again.");
  }
}

/* =========================================================
   8. SHARED ADMIN NAVIGATION
========================================================= */

function initializeNavigation() {
  const body = document.body;
  const toggle = PK.$("sidebarToggle");

  if (toggle) {
    toggle.addEventListener("click", () => {
      const opened = body.classList.toggle("sidebar-open");

      toggle.setAttribute(
        "aria-expanded",
        String(opened)
      );
    });
  }

  PK.all("[data-view]").forEach(element => {
    element.addEventListener("click", event => {
      const view = element.dataset.view;

      if (!view || !PK.$(`${view}View`)) return;

      event.preventDefault();

      navigateToView(view);
    });
  });

  window.addEventListener("hashchange", () => {
    const view = location.hash.replace("#", "");

    if (PK.$(`${view}View`)) {
      showView(view, false);
    }
  });

  if (PK.$("logoutButton")) {
    PK.$("logoutButton").addEventListener(
      "click",
      signOutAdmin
    );
  }

  const initialView = location.hash.replace("#", "");

  showView(
    PK.$(`${initialView}View`) ? initialView : "dashboard",
    false
  );
}

function showView(view, updateHash = true) {
  PK.all(".page-view").forEach(section => {
    const active = section.dataset.page === view;

    section.hidden = !active;
    section.classList.toggle("is-active", active);
  });

  PK.all(".app-navigation [data-view]").forEach(link => {
    link.classList.toggle(
      "is-active",
      link.dataset.view === view
    );
  });

  if (updateHash) {
    history.replaceState(null, "", `#${view}`);
  }

  document.body.classList.remove("sidebar-open");

  if (view === "dashboard") loadDashboard();
  if (view === "sets") loadSets();
  if (view === "reveal") loadReveal();
  if (view === "history") loadHistory();
  if (view === "subjects") loadSubjects();
  if (view === "settings") loadSettings();
}

function navigateToView(view) {
  showView(view);
}

/* =========================================================
   9. SHARED DATA HELPERS
========================================================= */

function getStatus(record) {
  if (record.revealedAt) return "revealed";
  if (record.postedAt) return "posted";
  if (record.status === "ready") return "ready";

  return "generating";
}

function statusLabel(status) {
  return ({
    generating: "Generating",
    ready: "Ready",
    posted: "Posted",
    revealed: "Revealed"
  })[status] || "Unknown";
}

function createStatusBadge(record) {
  const status = getStatus(record);

  return PK.create(
    "span",
    `status-badge ${status === "ready" ? "is-success" : ""} ${status === "posted" ? "is-pending" : ""}`,
    statusLabel(status)
  );
}

function renderEmptyRow(tbody, colspan, message) {
  tbody.replaceChildren();

  const row = document.createElement("tr");
  const cell = PK.create("td", "", message);

  cell.colSpan = colspan;
  row.append(cell);
  tbody.append(row);
}

function addSelectOptions(select, items, label) {
  if (!select) return;

  select.replaceChildren();

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = label;

  select.append(allOption);

  for (const item of items) {
    if (item.active === false) continue;

    const option = document.createElement("option");
    option.value = item.code || item.id || "";
    option.textContent =
      item.name || item.code || item.id || "";

    select.append(option);
  }
}

async function loadReferenceData() {
  const [examResult, subjectResult] =
    await Promise.all([
      API.getExams(),
      API.getSubjects()
    ]);

  PK_STATE.exams = Array.isArray(examResult.exams)
    ? examResult.exams
    : [];

  PK_STATE.subjects = Array.isArray(subjectResult.subjects)
    ? subjectResult.subjects
    : [];

  return {
    exams: PK_STATE.exams,
    subjects: PK_STATE.subjects
  };
}

/* =========================================================
   10. DASHBOARD
========================================================= */

async function loadDashboard() {
  const button = PK.$("refreshDashboardButton");

  if (button) button.disabled = true;

  try {
    const [dashboard, setResult] = await Promise.all([
      API.getDashboard(),
      API.getSets()
    ]);

    const stats = dashboard.stats || {};

    PK.text("totalSetsCount", stats.totalSets || 0);
    PK.text("totalQuestionsCount", stats.totalQuestions || 0);
    PK.text("postedSetsCount", stats.postedSets || 0);
    PK.text("pendingRevealsCount", stats.pendingReveals || 0);

    renderDashboardSets(
      Array.isArray(setResult.sets)
        ? setResult.sets.slice(0, 5)
        : []
    );

    renderActivities(dashboard.activities || []);

  } catch (error) {
    console.error("Dashboard loading error:", error);

    renderEmptyRow(
      PK.$("dashboardSetsBody"),
      5,
      "Unable to load dashboard records."
    );

    PK.text("dashboardActivities", error.message);

  } finally {
    if (button) button.disabled = false;
  }
}

function renderDashboardSets(sets) {
  const body = PK.$("dashboardSetsBody");
  if (!body) return;

  if (!sets.length) {
    renderEmptyRow(body, 5, "No MCQ sets created yet.");
    return;
  }

  body.replaceChildren();

  for (const set of sets) {
    const row = document.createElement("tr");

    const fields = [
      set.id || "—",
      set.exam || "—",
      set.subject || "—"
    ];

    fields.forEach(value => {
      row.append(PK.create("td", "", value));
    });

    const statusCell = document.createElement("td");
    statusCell.append(createStatusBadge(set));
    row.append(statusCell);

    row.append(
      PK.create("td", "", PK.formatDate(set.createdAt))
    );

    body.append(row);
  }
}

function renderActivities(activities) {
  const container = PK.$("dashboardActivities");
  if (!container) return;

  container.replaceChildren();

  if (!activities.length) {
    container.append(
      PK.create("div", "empty-state", "No recent activities.")
    );
    return;
  }

  for (const activity of activities.slice(0, 10)) {
    const item = PK.create("div", "activity-item");

    item.append(
      PK.create("strong", "", activity.message || activity.type || "Activity"),
      PK.create("span", "", PK.formatDate(activity.timestamp))
    );

    container.append(item);
  }
}

/* =========================================================
   11. MANAGE SETS
========================================================= */

async function loadSets() {
  const button = PK.$("refreshSetsButton");

  if (button) button.disabled = true;

  try {
    await loadReferenceData();

    addSelectOptions(
      PK.$("setsExamFilter"),
      PK_STATE.exams,
      "All Exams"
    );

    addSelectOptions(
      PK.$("setsSubjectFilter"),
      PK_STATE.subjects,
      "All Subjects"
    );

    const result = await API.getSets();

    PK_STATE.sets = Array.isArray(result.sets)
      ? result.sets
      : [];

    PK_STATE.sets.sort(
      (a, b) => Number(b.createdAt || 0) -
                Number(a.createdAt || 0)
    );

    applySetFilters();

  } catch (error) {
    console.error("Sets loading error:", error);

    renderEmptyRow(
      PK.$("setsTableBody"),
      7,
      "Unable to load question sets."
    );

  } finally {
    if (button) button.disabled = false;
  }
}

function applySetFilters() {
  const search = (PK.$("setsSearch")?.value || "")
    .trim()
    .toLowerCase();

  const exam = PK.$("setsExamFilter")?.value || "";
  const subject = PK.$("setsSubjectFilter")?.value || "";
  const status = PK.$("setsStatusFilter")?.value || "";

  PK_STATE.filteredSets = PK_STATE.sets.filter(set => {
    const matchesSearch =
      !search ||
      String(set.id || "").toLowerCase().includes(search);

    const matchesExam =
      !exam || set.exam === exam;

    const matchesSubject =
      !subject || set.subject === subject;

    const matchesStatus =
      !status || getStatus(set) === status;

    return (
      matchesSearch &&
      matchesExam &&
      matchesSubject &&
      matchesStatus
    );
  });

  PK_STATE.setsPage = 1;
  renderSetTable();
}

function renderSetTable() {
  const body = PK.$("setsTableBody");
  if (!body) return;

  body.replaceChildren();

  const total = PK_STATE.filteredSets.length;
  const pages = Math.max(
    1,
    Math.ceil(total / PK_CONFIG.PAGE_SIZE)
  );

  PK_STATE.setsPage = Math.min(
    PK_STATE.setsPage,
    pages
  );

  const start = (PK_STATE.setsPage - 1) * PK_CONFIG.PAGE_SIZE;

  const visible = PK_STATE.filteredSets.slice(
    start,
    start + PK_CONFIG.PAGE_SIZE
  );

  for (const set of visible) {
    const row = document.createElement("tr");

    row.append(
      PK.create("td", "", set.id || "—"),
      PK.create("td", "", set.exam || "—"),
      PK.create("td", "", set.subject || "—"),
      PK.create("td", "", set.questions?.length || 0)
    );

    const statusCell = document.createElement("td");
    statusCell.append(createStatusBadge(set));
    row.append(statusCell);

    row.append(
      PK.create("td", "", PK.formatDate(set.createdAt))
    );

    const actionCell = document.createElement("td");
    const detailsButton = PK.create(
      "button",
      "btn btn-secondary",
      "View"
    );

    detailsButton.type = "button";
    detailsButton.addEventListener(
      "click",
      () => showSetDetails(set)
    );

    actionCell.append(detailsButton);
    row.append(actionCell);

    body.append(row);
  }

  PK.$("setsEmptyState").hidden = total !== 0;

  if (!total) {
    renderEmptyRow(body, 7, "No matching sets found.");
  }

  const first = total ? start + 1 : 0;
  const last = Math.min(
    start + PK_CONFIG.PAGE_SIZE,
    total
  );

  PK.text("setsPageInfo", `Showing ${first}–${last} of ${total}`);
  PK.text("setsCurrentPage", `${PK_STATE.setsPage} / ${pages}`);

  PK.$("setsPreviousPage").disabled = PK_STATE.setsPage <= 1;
  PK.$("setsNextPage").disabled = PK_STATE.setsPage >= pages;
}

/* =========================================================
   12. SET DETAILS DIALOG
========================================================= */

function showSetDetails(set) {
  const dialog = PK.$("setDetailsDialog");
  const container = PK.$("setDetailsContent");

  if (!dialog || !container) return;

  PK.text("setDetailsSubtitle", set.id || "Set details");

  container.replaceChildren();

  const information = [
    ["Exam", set.exam],
    ["Subject", set.subject],
    ["Language", set.language],
    ["Status", statusLabel(getStatus(set))],
    ["Created", PK.formatDate(set.createdAt)],
    ["Posted", PK.formatDate(set.postedAt)],
    ["Revealed", PK.formatDate(set.revealedAt)]
  ];

  for (const [label, value] of information) {
    const item = PK.create("p");

    item.append(
      PK.create("strong", "", `${label}: `),
      PK.create("span", "", value || "—")
    );

    container.append(item);
  }

  if (set.postUrl) {
    const link = document.createElement("a");
    link.href = set.postUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open Instagram Post";

    container.append(link);
  }

  for (const [index, question] of
    (set.questions || []).entries()) {

    const card = PK.create("section", "question-detail");

    card.append(
      PK.create("h3", "", `Question ${index + 1}`),
      PK.create(
        "p",
        "",
        question.question || question.text || "Question"
      )
    );

    for (const [optionIndex, option] of
      (question.options || []).entries()) {

      const letter = ["A", "B", "C", "D"][optionIndex];

      const value =
        typeof option === "string"
          ? option
          : option.text || option.english || "";

      card.append(
        PK.create("p", "", `${letter}) ${value}`)
      );
    }

    card.append(
      PK.create(
        "p",
        "",
        `Correct answer: ${question.answer || "Not available"}`
      )
    );

    if (question.explanation) {
      card.append(
        PK.create("p", "", `Explanation: ${question.explanation}`)
      );
    }

    container.append(card);
  }

  dialog.showModal();
}

/* =========================================================
   13. ANSWER REVEAL
========================================================= */

async function loadReveal() {
  if (PK_STATE.revealLoading) return;

  PK_STATE.revealLoading = true;

  const button = PK.$("refreshRevealButton");
  if (button) button.disabled = true;

  PK.text("revealStatus", "Loading publication records...");

  try {
    const result = await API.getSets();

    PK_STATE.sets = Array.isArray(result.sets)
      ? result.sets
      : [];

    renderRevealSets();

  } catch (error) {
    PK.text("revealStatus", error.message);

  } finally {
    PK_STATE.revealLoading = false;

    if (button) button.disabled = false;
  }
}

function renderRevealSets() {
  const container = PK.$("revealSetsList");
  container.replaceChildren();

  const sets = PK_STATE.sets.filter(
    set => set.status === "ready"
  );

  const ready = sets.filter(set => !set.postedAt);
  const pending = sets.filter(
    set => set.postedAt && !set.revealedAt
  );
  const revealed = sets.filter(set => set.revealedAt);

  PK.text("readySetsCount", ready.length);
  PK.text("revealPendingCount", pending.length);
  PK.text("revealCompletedCount", revealed.length);

  const empty = PK.$("revealEmptyState");
  empty.hidden = sets.length > 0;

  PK.text(
    "revealStatus",
    `${sets.length} ready set(s).`
  );

  for (const set of sets) {
    container.append(createRevealCard(set));
  }
}

function createRevealCard(set) {
  const card = PK.create("article", "record-card");

  card.append(
    PK.create("h3", "", set.id),
    PK.create(
      "p",
      "",
      `${set.exam} · ${set.subject} · Created ${PK.formatDate(set.createdAt)}`
    )
  );

  const status = createStatusBadge(set);
  card.append(status);

  if (!set.postedAt) {
    const form = PK.create("form", "record-actions");

    const input = document.createElement("input");
    input.type = "url";
    input.placeholder = "Instagram post URL (optional)";
    input.className = "form-control";

    const button = PK.create(
      "button",
      "btn btn-primary",
      "Mark as Posted"
    );

    button.type = "submit";

    form.append(input, button);

    form.addEventListener("submit", async event => {
      event.preventDefault();

      button.disabled = true;
      button.textContent = "Saving...";

      try {
        await API.markPosted(set.id, input.value.trim());
        await loadReveal();

      } catch (error) {
        alert(error.message);
        button.disabled = false;
        button.textContent = "Mark as Posted";
      }
    });

    card.append(form);
  }

  if (set.postedAt && !set.revealedAt) {
    card.append(
      PK.create(
        "p",
        "",
        `Posted: ${PK.formatDate(set.postedAt)}`
      )
    );

    const button = PK.create(
      "button",
      "btn btn-primary",
      "Reveal Answers Now"
    );

    button.type = "button";

    button.addEventListener("click", async () => {
      if (!confirm(`Reveal answers for ${set.id}?`)) {
        return;
      }

      button.disabled = true;

      try {
        await API.revealSet(set.id);
        await loadReveal();

      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    });

    card.append(button);
  }

  if (set.revealedAt) {
    card.append(
      PK.create(
        "p",
        "",
        `Revealed: ${PK.formatDate(set.revealedAt)}`
      )
    );

    const button = PK.create(
      "button",
      "btn btn-secondary",
      "Load Answer Images"
    );

    button.type = "button";

    button.addEventListener("click", async () => {
      await loadAnswerImagePreviews(set.id);
    });

    card.append(button);
  }

  return card;
}

async function loadAnswerImagePreviews(setId) {
  const container = PK.$("answerImagePreview");

  container.replaceChildren();
  PK.revokeObjectUrls();

  for (let number = 1; number <= 5; number++) {
    try {
      const blob = await API.getAnswerImage(
        setId,
        number
      );

      const url = URL.createObjectURL(blob);
      PK_STATE.objectUrls.push(url);

      const image = document.createElement("img");
      image.src = url;
      image.alt = `Answer for question ${number}`;

      container.append(image);

    } catch (error) {
      console.error(
        `Unable to load answer image Q${number}:`,
        error
      );
    }
  }

  if (!container.children.length) {
    container.textContent =
      "Unable to load answer images.";
  }
}

/* =========================================================
   14. HISTORY
========================================================= */

async function loadHistory() {
  const button = PK.$("refreshHistoryButton");
  if (button) button.disabled = true;

  try {
    await loadReferenceData();

    addSelectOptions(
      PK.$("historyExamFilter"),
      PK_STATE.exams,
      "All Exams"
    );

    addSelectOptions(
      PK.$("historySubjectFilter"),
      PK_STATE.subjects,
      "All Subjects"
    );

    const result = await API.getHistory();

    PK_STATE.history = Array.isArray(result.history)
      ? result.history
      : [];

    PK_STATE.history.sort(
      (a, b) =>
        Number(b.createdAt || 0) -
        Number(a.createdAt || 0)
    );

    applyHistoryFilters();

  } catch (error) {
    console.error("History loading error:", error);

    renderEmptyRow(
      PK.$("historyTableBody"),
      7,
      "Unable to load history."
    );

  } finally {
    if (button) button.disabled = false;
  }
}

function applyHistoryFilters() {
  const search =
    (PK.$("historySearch")?.value || "")
      .trim()
      .toLowerCase();

  const exam = PK.$("historyExamFilter")?.value || "";
  const subject = PK.$("historySubjectFilter")?.value || "";
  const status = PK.$("historyStatusFilter")?.value || "";

  PK_STATE.filteredHistory = PK_STATE.history.filter(record =>
    (!search || String(record.id || "").toLowerCase().includes(search)) &&
    (!exam || record.exam === exam) &&
    (!subject || record.subject === subject) &&
    (!status || getStatus(record) === status)
  );

  PK_STATE.historyPage = 1;

  renderHistoryTable();
}

function renderHistoryTable() {
  const body = PK.$("historyTableBody");
  body.replaceChildren();

  const total = PK_STATE.filteredHistory.length;
  const pages = Math.max(
    1,
    Math.ceil(total / PK_CONFIG.PAGE_SIZE)
  );

  PK_STATE.historyPage = Math.min(
    PK_STATE.historyPage,
    pages
  );

  const start =
    (PK_STATE.historyPage - 1) * PK_CONFIG.PAGE_SIZE;

  const visible = PK_STATE.filteredHistory.slice(
    start,
    start + PK_CONFIG.PAGE_SIZE
  );

  for (const record of visible) {
    const row = document.createElement("tr");

    row.append(
      PK.create("td", "", record.id || "—"),
      PK.create("td", "", record.exam || "—"),
      PK.create("td", "", record.subject || "—"),
      PK.create("td", "", PK.formatDate(record.createdAt)),
      PK.create("td", "", PK.formatDate(record.postedAt)),
      PK.create("td", "", PK.formatDate(record.revealedAt))
    );

    const status = document.createElement("td");
    status.append(createStatusBadge(record));
    row.append(status);

    body.append(row);
  }

  PK.$("historyEmptyState").hidden = total !== 0;

  if (!total) {
    renderEmptyRow(body, 7, "No history records found.");
  }

  const first = total ? start + 1 : 0;
  const last = Math.min(
    start + PK_CONFIG.PAGE_SIZE,
    total
  );

  PK.text("historyPageInfo", `Showing ${first}–${last} of ${total}`);
  PK.text("historyCurrentPage", `${PK_STATE.historyPage} / ${pages}`);

  PK.$("historyPreviousPage").disabled =
    PK_STATE.historyPage <= 1;

  PK.$("historyNextPage").disabled =
    PK_STATE.historyPage >= pages;
}

/* =========================================================
   15. SUBJECTS
========================================================= */

async function loadSubjects() {
  const button = PK.$("refreshSubjectsButton");
  if (button) button.disabled = true;

  try {
    const result = await API.getSubjects();

    PK_STATE.subjects = Array.isArray(result.subjects)
      ? result.subjects
      : [];

    const active = PK_STATE.subjects.filter(
      subject => subject.active !== false
    );

    PK.text("totalSubjectsCount", PK_STATE.subjects.length);
    PK.text("activeSubjectsCount", active.length);

    const body = PK.$("subjectsTableBody");
    body.replaceChildren();

    for (const subject of PK_STATE.subjects) {
      const row = document.createElement("tr");

      row.append(
        PK.create("td", "", subject.code || "—"),
        PK.create("td", "", subject.name || "—")
      );

      const statusCell = document.createElement("td");

      const badge = PK.create(
        "span",
        "status-badge",
        subject.active === false ? "Inactive" : "Active"
      );

      statusCell.append(badge);
      row.append(statusCell);
      body.append(row);
    }

    PK.$("subjectsEmptyState").hidden =
      PK_STATE.subjects.length > 0;

    if (!PK_STATE.subjects.length) {
      renderEmptyRow(body, 3, "No subjects available.");
    }

    PK.text(
      "subjectsStatus",
      `${PK_STATE.subjects.length} subject(s) loaded.`
    );

  } catch (error) {
    PK.text("subjectsStatus", error.message);

    renderEmptyRow(
      PK.$("subjectsTableBody"),
      3,
      "Unable to load subjects."
    );

  } finally {
    if (button) button.disabled = false;
  }
}

/* =========================================================
   16. SETTINGS
========================================================= */

async function loadSettings() {
  const button = PK.$("refreshSettingsButton");
  if (button) button.disabled = true;

  try {
    const result = await API.getSettings();
    const settings = result.settings || {};

    const delay = Number(
      settings.revealDelayHours ?? PK_CONFIG.DEFAULT_REVEAL_HOURS
    );

    PK.text("settingQuestionCount", 5);
    PK.text("settingImageCount", 10);
    PK.text(
      "settingRevealDelay",
      `${delay} Hour${delay === 1 ? "" : "s"}`
    );

    const rows = [
      ["Questions per set", 5],
      ["Teaser images", 5],
      ["Answer images", 5],
      ["Total images", 10],
      ["Answer reveal delay", `${delay} hours`],
      ["Timezone", "Asia/Kolkata (IST)"],
      ["Set ID format", "PREPAREKORA/EXAM/SUBJECT/MM/YY/NNNN"],
      ["Subjects", "GK, SS, ENG, MATH, LR, CK"],
      ["Storage", "Cloudinary (authenticated answer images)"],
      ["Database", "Firebase Realtime Database"]
    ];

    const body = PK.$("settingsTableBody");
    body.replaceChildren();

    for (const [label, value] of rows) {
      const row = document.createElement("tr");

      row.append(
        PK.create("td", "", label),
        PK.create("td", "", value)
      );

      body.append(row);
    }

    PK.text("settingsStatus", "Settings loaded.");

  } catch (error) {
    PK.text("settingsStatus", error.message);

    renderEmptyRow(
      PK.$("settingsTableBody"),
      2,
      "Unable to load settings."
    );

  } finally {
    if (button) button.disabled = false;
  }
}

/* =========================================================
   17. MCQ PARSER
   Format: Q:, A), B), C), D), Ans:, Explanation:
========================================================= */

function splitLanguage(text) {
  const value = String(text || "").trim();

  const match = value.match(
    /^(.*?)\s*\(([^()]*)\)\s*$/
  );

  if (!match) {
    return {
      original: value,
      english: value,
      assamese: value
    };
  }

  return {
    original: value,
    english: match[1].trim(),
    assamese: match[2].trim()
  };
}

function parseMCQContent(content) {
  const lines = String(content || "")
    .replace(/\r/g, "")
    .split("\n");

  const questions = [];
  let current = null;
  let currentMode = "question";

  function finishQuestion() {
    if (!current) return;

    questions.push(current);
    current = null;
    currentMode = "question";
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) continue;

    const questionMatch = line.match(
      /^Q\s*:\s*(.*)$/i
    );

    if (questionMatch) {
      finishQuestion();

      const language = splitLanguage(questionMatch[1]);

      current = {
        question: language.original,
        english: language.english,
        assamese: language.assamese,
        options: [],
        answer: "",
        correctIndex: -1,
        explanation: ""
      };

      currentMode = "question";
      continue;
    }

    if (!current) continue;

    const optionMatch = line.match(
      /^([A-D])\s*[).:-]\s*(.*)$/i
    );

    if (optionMatch) {
      const language = splitLanguage(optionMatch[2]);

      current.options.push({
        letter: optionMatch[1].toUpperCase(),
        text: language.original,
        english: language.english,
        assamese: language.assamese
      });

      currentMode = "option";
      continue;
    }

    const answerMatch = line.match(
      /^Ans(?:wer)?\s*[:=-]\s*([A-D])\b/i
    );

    if (answerMatch) {
      current.answer = answerMatch[1].toUpperCase();
      current.correctIndex =
        ["A", "B", "C", "D"].indexOf(current.answer);

      currentMode = "answer";
      continue;
    }

    const explanationMatch = line.match(
      /^Explanation\s*:\s*(.*)$/i
    );

    if (explanationMatch) {
      current.explanation = explanationMatch[1].trim();
      currentMode = "explanation";
      continue;
    }

    if (currentMode === "explanation") {
      current.explanation +=
        `${current.explanation ? "\n" : ""}${line}`;

    } else if (currentMode === "question") {
      current.question +=
        `${current.question ? "\n" : ""}${line}`;
    }
  }

  finishQuestion();

  return questions.map((question, index) => ({
    ...question,
    number: index + 1,
    id: `Q${index + 1}`
  }));
}

/* =========================================================
   18. MCQ VALIDATION
========================================================= */

function validateMCQs(questions) {
  if (questions.length !== PK_CONFIG.QUESTION_COUNT) {
    throw new Error(
      "Exactly five questions are required."
    );
  }

  const seen = new Set();

  for (let index = 0; index < questions.length; index++) {
    const question = questions[index];
    const number = index + 1;

    if (!question.question.trim()) {
      throw new Error(`Q${number}: Question text is missing.`);
    }

    if (question.options.length !== 4) {
      throw new Error(
        `Q${number}: Exactly four options are required.`
      );
    }

    const expected = ["A", "B", "C", "D"];

    for (let optionIndex = 0; optionIndex < 4; optionIndex++) {
      const option = question.options[optionIndex];

      if (
        option.letter !== expected[optionIndex] ||
        !option.text.trim()
      ) {
        throw new Error(
          `Q${number}: Option ${expected[optionIndex]} is missing or misplaced.`
        );
      }
    }

    if (
      !["A", "B", "C", "D"].includes(question.answer)
    ) {
      throw new Error(
        `Q${number}: A valid answer from A to D is required.`
      );
    }

    const normalized = question.english
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/g, " ");

    if (seen.has(normalized)) {
      throw new Error(
        `Duplicate question detected inside the set at Q${number}.`
      );
    }

    seen.add(normalized);
  }

  return true;
}

/* =========================================================
   19. STUDIO LANGUAGE AND PREVIEW
========================================================= */

function selectedText(item, language) {
  if (language === "en") {
    return item.english || item.text || item.question || "";
  }

  if (language === "as") {
    return item.assamese || item.text || item.question || "";
  }

  return item.text || item.question || "";
}

function getStudioLanguage() {
  return PK.$("languageMode")?.value || "bilingual";
}

function updatePoster() {
  const studio = PK_STATE.studio;

  const question = studio.questions[studio.currentQuestion];

  if (!question) return;

  const language = getStudioLanguage();
  const mode = studio.imageMode;

  const displayQuestion = language === "en"
    ? question.english
    : language === "as"
      ? question.assamese
      : question.question;

  PK.text("posterSubject", PK.$("subjectSelect")?.selectedOptions[0]?.textContent?.toUpperCase() || "SUBJECT");

  PK.text("posterQuestion", displayQuestion);

  for (const letter of ["A", "B", "C", "D"]) {
    const option = question.options.find(
      item => item.letter === letter
    );

    const element = PK.$(`option${letter}Text`);

    if (element && option) {
      element.textContent = selectedText(
        option,
        language
      );
    }
  }

  PK.text(
    "posterId",
    studio.setId || "PREPAREKORA"
  );

  if (mode === "answer") {
    const correct = question.options.find(
      option => option.letter === question.answer
    );

    const answerText = correct
      ? selectedText(correct, language)
      : "";

    PK.text("commentsTitle", "CORRECT ANSWER");

    PK.text(
      "commentsText",
      `${question.answer}) ${answerText}${question.explanation ? ` — ${question.explanation}` : ""}`
    );

  } else {
    PK.text(
      "commentsTitle",
      PK.$("commentsTitleInput")?.value || "COMMENTS"
    );

    PK.text(
      "commentsText",
      PK.$("commentsTextInput")?.value ||
        "Share your answer in the comments."
    );
  }

  const selector = PK.$("questionSelector");

  if (selector) {
    selector.value = String(studio.currentQuestion);
  }

  const modeSelector = PK.$("imageMode");

  if (modeSelector) {
    modeSelector.value = mode;
  }

  updateQR();
}

function updateQR() {
  const container = PK.$("previewQrCode");

  if (!container) return;

  const url = PK.$("qrUrl")?.value.trim();

  if (!url || !window.QRCode) {
    container.replaceChildren();
    return;
  }

  container.replaceChildren();

  try {
    new QRCode(container, {
      text: url,
      width: 90,
      height: 90,
      colorDark: "#171717",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });
  } catch (error) {
    console.warn("QR code rendering failed:", error);
  }
}

/* =========================================================
   20. IMAGE DIMENSIONS
========================================================= */

function getImageDimensions() {
  const ratio = PK.$("aspectRatio")?.value || "1:1";

  if (ratio === "custom") {
    const width = Number(PK.$("customWidth")?.value);
    const height = Number(PK.$("customHeight")?.value);

    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 400 ||
      height < 400 ||
      width > 8000 ||
      height > 8000
    ) {
      throw new Error("Custom image dimensions must be between 400 and 8000 pixels.");
    }

    return [width, height];
  }

  return PK_CONFIG.RATIOS[ratio] ||
    PK_CONFIG.RATIOS["1:1"];
}

function updateDimensions() {
  const custom = PK.$("aspectRatio")?.value === "custom";

  PK.$("customDimensions").hidden = !custom;

  try {
    const [width, height] = getImageDimensions();

    PK.text(
      "canvasDimensions",
      `Output dimensions: ${width} × ${height} px`
    );

    PK.text(
      "exportInfo",
      `Five teaser images and five answer images. Output: ${width} × ${height}px.`
    );

    updatePosterPreviewSize(width, height);

  } catch (error) {
    PK.text("canvasDimensions", error.message);
  }
}

function updatePosterPreviewSize(width, height) {
  const poster = PK.$("poster");

  if (!poster) return;

  const maxPreviewWidth = 540;
  const maxPreviewHeight = 675;

  const scale = Math.min(
    maxPreviewWidth / width,
    maxPreviewHeight / height
  );

  poster.style.width = `${Math.round(width * scale)}px`;
  poster.style.height = `${Math.round(height * scale)}px`;
}

/* =========================================================
   21. IMAGE EXPORT
========================================================= */

async function renderPosterImage(questionIndex, mode) {
  if (!window.html2canvas) {
    throw new Error("Image rendering library is unavailable.");
  }

  const poster = PK.$("poster");

  if (!poster) {
    throw new Error("Poster preview is unavailable.");
  }

  const [width, height] = getImageDimensions();

  const requestedScale = Number(
    PK.$("exportResolution")?.value || 4
  );

  const maxPixelScale = Math.sqrt(
    PK_CONFIG.MAX_IMAGE_PIXELS / (width * height)
  );

  const maxDimensionScale =
    PK_CONFIG.MAX_IMAGE_DIMENSION / Math.max(width, height);

  const scale = Math.min(
    requestedScale,
    maxPixelScale,
    maxDimensionScale
  );

  PK_STATE.studio.currentQuestion = questionIndex;
  PK_STATE.studio.imageMode = mode;

  updatePoster();

  await PK.nextFrame();
  await PK.nextFrame();

  const originalWidth = poster.style.width;
  const originalHeight = poster.style.height;

  poster.style.width = `${width}px`;
  poster.style.height = `${height}px`;

  try {
    const canvas = await html2canvas(poster, {
      scale,
      backgroundColor: "#ffffff",
      width,
      height,
      useCORS: true,
      logging: false,
      imageTimeout: 15000,
      removeContainer: true
    });

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        result => result
          ? resolve(result)
          : reject(new Error("Image export failed.")),
        "image/png"
      );
    });

    if (blob.size > PK_CONFIG.MAX_IMAGE_BYTES) {
      throw new Error(
        "Image exceeds the 20 MB upload limit. Choose a lower export resolution."
      );
    }

    return blob;

  } finally {
    poster.style.width = originalWidth;
    poster.style.height = originalHeight;
    updatePoster();
  }
}

/* =========================================================
   22. TEN-IMAGE GENERATION
========================================================= */

async function generateCompleteSet() {
  const studio = PK_STATE.studio;

  if (studio.generationRunning) return;

  if (!studio.valid || studio.questions.length !== 5) {
    alert("Validate all five MCQs before generating images.");
    return;
  }

  const exam = PK.$("examSelect").value;
  const subject = PK.$("subjectSelect").value;

  if (!exam || !subject) {
    alert("Select an examination and subject.");
    return;
  }

  const button = PK.$("exportButton");
  const panel = PK.$("generationPanel");
  const progress = PK.$("generationProgress");

  studio.generationRunning = true;

  button.disabled = true;
  button.textContent = "Generating...";

  PK.show(panel);
  progress.replaceChildren();

  try {
    if (!studio.setId) {
      studio.idempotencyKey ||= crypto.randomUUID();

      PK.text("generationStatus", "Allocating secure Set ID...");

      const draft = {
        examCode: exam,
        subjectCode: subject,
        language: getStudioLanguage(),
        questions: studio.questions.map((question, index) => ({
          number: index + 1,
          question: question.question,
          english: question.english,
          assamese: question.assamese,

          options: question.options.map(option => ({
            letter: option.letter,
            text: option.text,
            english: option.english,
            assamese: option.assamese
          })),

          answer: question.answer,
          correctIndex: question.correctIndex,
          explanation: question.explanation
        }))
      };

      const created = await API.createSet(
        draft,
        studio.idempotencyKey
      );

      if (!created.ok || !created.setId) {
        throw new Error("Worker did not allocate a valid Set ID.");
      }

      studio.setId = created.setId;

      PK.text("setIdPreview", studio.setId);
      PK.text("posterId", studio.setId);
    }

    let uploaded = Object.keys(studio.uploadedAssets).length;

    for (let questionIndex = 0; questionIndex < 5; questionIndex++) {
      for (const mode of PK_CONFIG.IMAGE_TYPES) {
        const cacheKey = `${questionIndex + 1}:${mode}`;

        if (studio.uploadedAssets[cacheKey]) {
          continue;
        }

        PK.text(
          "generationStatus",
          `Generating Q${questionIndex + 1} — ${mode} image...`
        );

        const blob = await renderPosterImage(
          questionIndex,
          mode
        );

        const assetResult = await API.uploadAsset({
          blob,
          fileName: `Q${questionIndex + 1}-${mode}.png`,
          setId: studio.setId,
          questionId: `${studio.setId}-Q${questionIndex + 1}`,
          imageMode: mode
        });

        if (!assetResult.ok) {
          throw new Error(
            `Upload failed for Q${questionIndex + 1} ${mode}.`
          );
        }

        studio.uploadedAssets[cacheKey] =
          assetResult.asset;

        uploaded++;

        renderGenerationProgress(progress, uploaded);

        PK.text(
          "generationStatus",
          `${uploaded} of 10 images uploaded.`
        );
      }
    }

    PK.text(
      "generationStatus",
      "Finalizing all ten images..."
    );

    const completed = await API.completeGeneration(
      studio.setId
    );

    if (!completed.ok) {
      throw new Error(
        completed.error || "Image generation finalization failed."
      );
    }

    PK.text(
      "generationStatus",
      `Generation complete. Set ID: ${studio.setId}`
    );

    button.textContent = "Generation Completed";

    alert(
      `Successfully generated all ten images.\n\nSet ID: ${studio.setId}`
    );

  } catch (error) {
    console.error("Generation failed:", error);

    PK.text(
      "generationStatus",
      error.message || "Generation failed. Retry is possible."
    );

    button.disabled = false;
    button.textContent = "Retry Image Generation";

  } finally {
    studio.generationRunning = false;
  }
}

function renderGenerationProgress(container, uploaded) {
  container.replaceChildren();

  const label = PK.create(
    "p",
    "",
    `${uploaded} / 10 images uploaded`
  );

  const track = PK.create("div", "generation-track");
  const bar = PK.create("div", "generation-bar");

  bar.style.width = `${uploaded * 10}%`;

  track.append(bar);
  container.append(label, track);
}

/* =========================================================
   23. STUDIO CONTROLLER
========================================================= */

function initializeStudio() {
  if (!PK.$("bulkContent")) return;

  const content = PK.$("bulkContent");

  const invalidate = () => {
    const studio = PK_STATE.studio;

    studio.valid = false;
    studio.setId = null;
    studio.idempotencyKey = null;
    studio.uploadedAssets = {};

    PK.text("setIdPreview", "Will be generated by the server");
    PK.$("exportButton").disabled = true;

    PK.text(
      "editorStatus",
      "Content changed. Validate the five MCQs again."
    );
  };

  content.addEventListener("input", () => {
    if (content.value !== PK_STATE.studio.lastContent) {
      invalidate();
    }
  });

  PK.$("previewButton").addEventListener("click", () => {
    try {
      const questions = parseMCQContent(content.value);

      validateMCQs(questions);

      PK_STATE.studio.questions = questions;
      PK_STATE.studio.currentQuestion = 0;
      PK_STATE.studio.imageMode = "teaser";
      PK_STATE.studio.valid = true;
      PK_STATE.studio.lastContent = content.value;

      PK.$("exportButton").disabled = false;

      updatePoster();

      PK.text(
        "editorStatus",
        "All five MCQs validated successfully."
      );

      PK.text(
        "generationStatus",
        "Ready to generate ten images."
      );

    } catch (error) {
      PK_STATE.studio.valid = false;
      PK.$("exportButton").disabled = true;

      PK.text(
        "editorStatus",
        error.message
      );
    }
  });

  PK.$("questionSelector").addEventListener("change", event => {
    PK_STATE.studio.currentQuestion =
      Number(event.target.value);

    updatePoster();
  });

  PK.$("imageMode").addEventListener("change", event => {
    PK_STATE.studio.imageMode = event.target.value;
    updatePoster();
  });

  PK.$("languageMode").addEventListener("change", updatePoster);

  PK.$("subjectSelect").addEventListener("change", updatePoster);

  // Form inputs update the original poster preview elements.
  PK.$("commentsTitleInput").addEventListener("input", updatePoster);
  PK.$("commentsTextInput").addEventListener("input", updatePoster);

  PK.$("qrUrl").addEventListener("change", updateQR);

  PK.$("aspectRatio").addEventListener("change", updateDimensions);
  PK.$("customWidth").addEventListener("input", updateDimensions);
  PK.$("customHeight").addEventListener("input", updateDimensions);

  PK.$("exportResolution").addEventListener(
    "change",
    updateDimensions
  );

  PK.$("exportButton").addEventListener(
    "click",
    generateCompleteSet
  );

  const closeDialog = PK.$("closeStudioDialog");

  if (closeDialog) {
    closeDialog.addEventListener("click", () => {
      PK.$("studioDialog").close();
    });
  }

  PK.$("exportButton").disabled = true;

  updateDimensions();

  // Initialize the QR preview after external scripts load.
  setTimeout(updateQR, 500);
}

/* =========================================================
   24. GLOBAL EVENT WIRING
========================================================= */

function initializeAdminEvents() {
  PK.$("refreshDashboardButton")?.addEventListener(
    "click",
    loadDashboard
  );

  PK.$("refreshSetsButton")?.addEventListener(
    "click",
    loadSets
  );

  PK.$("refreshRevealButton")?.addEventListener(
    "click",
    loadReveal
  );

  PK.$("refreshHistoryButton")?.addEventListener(
    "click",
    loadHistory
  );

  PK.$("refreshSubjectsButton")?.addEventListener(
    "click",
    loadSubjects
  );

  PK.$("refreshSettingsButton")?.addEventListener(
    "click",
    loadSettings
  );

  for (const id of [
    "setsSearch",
    "setsExamFilter",
    "setsSubjectFilter",
    "setsStatusFilter"
  ]) {
    const element = PK.$(id);

    element?.addEventListener(
      id === "setsSearch" ? "input" : "change",
      applySetFilters
    );
  }

  for (const id of [
    "historySearch",
    "historyExamFilter",
    "historySubjectFilter",
    "historyStatusFilter"
  ]) {
    const element = PK.$(id);

    element?.addEventListener(
      id === "historySearch" ? "input" : "change",
      applyHistoryFilters
    );
  }

  PK.$("setsPreviousPage")?.addEventListener("click", () => {
    if (PK_STATE.setsPage > 1) {
      PK_STATE.setsPage--;
      renderSetTable();
    }
  });

  PK.$("setsNextPage")?.addEventListener("click", () => {
    const pages = Math.max(
      1,
      Math.ceil(
        PK_STATE.filteredSets.length /
        PK_CONFIG.PAGE_SIZE
      )
    );

    if (PK_STATE.setsPage < pages) {
      PK_STATE.setsPage++;
      renderSetTable();
    }
  });

  PK.$("historyPreviousPage")?.addEventListener("click", () => {
    if (PK_STATE.historyPage > 1) {
      PK_STATE.historyPage--;
      renderHistoryTable();
    }
  });

  PK.$("historyNextPage")?.addEventListener("click", () => {
    const pages = Math.max(
      1,
      Math.ceil(
        PK_STATE.filteredHistory.length /
        PK_CONFIG.PAGE_SIZE
      )
    );

    if (PK_STATE.historyPage < pages) {
      PK_STATE.historyPage++;
      renderHistoryTable();
    }
  });

  PK.$("closeSetDetails")?.addEventListener("click", () => {
    PK.$("setDetailsDialog")?.close();
  });
}

/* =========================================================
   25. APPLICATION STARTUP
========================================================= */

async function startPreparekora() {
  if (PK_STATE.initialized) return;

  try {
    const firebase = await initializeFirebase();

    PK_STATE.initialized = true;

    if (document.body.classList.contains("auth-page")) {
      await initializeLoginPage();
      return;
    }

    const isAdminPage =
      document.body.classList.contains("admin-page") &&
      !document.body.classList.contains("studio-page");

    const isStudioPage =
      document.body.classList.contains("studio-page");

    if (!isAdminPage && !isStudioPage) return;

    const authorized = await requireAdmin();

    if (!authorized) return;

    if (isAdminPage) {
      initializeNavigation();
      initializeAdminEvents();

      const view = location.hash.replace("#", "") || "dashboard";

      showView(
        PK.$(`${view}View`) ? view : "dashboard",
        false
      );
    }

    if (isStudioPage) {
      initializeStudio();

      // Load current exam and subject lists where available.
      try {
        const data = await loadReferenceData();

        addSelectOptions(
          PK.$("examSelect"),
          data.exams,
          "Select Examination"
        );

        addSelectOptions(
          PK.$("subjectSelect"),
          data.subjects,
          "Select Subject"
        );

      } catch (error) {
        console.error(
          "Studio reference-data loading failed:",
          error
        );
      }
    }

    window.addEventListener(
      "beforeunload",
      PK.revokeObjectUrls
    );

  } catch (error) {
    console.error("Preparekora startup error:", error);

    const status = PK.$("authStatus");

    if (status) {
      status.textContent =
        error.message || "Application initialization failed.";
    } else {
      alert(
        error.message ||
        "Preparekora could not initialize. Check Worker deployment."
      );
    }
  }
}

/* =========================================================
   26. START APPLICATION
========================================================= */

startPreparekora();
