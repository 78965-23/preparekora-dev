
/* =========================================
   PREPAREKORA — IMAGE WORKSPACE DATABASE
   ========================================= */

(() => {
  "use strict";

  const API = "https://preparekora-studio-api.yadavsubba2003.workers.dev";

  const el = {
    subject: document.getElementById("ig-subject-filter"),
    topic: document.getElementById("ig-topic-filter"),
    type: document.getElementById("ig-type-filter"),
    search: document.getElementById("ig-search"),
    load: document.getElementById("ig-load-questions"),
    selectAll: document.getElementById("ig-select-all"),
    clear: document.getElementById("ig-clear-selection"),
    list: document.getElementById("ig-question-list"),
    count: document.getElementById("ig-selected-count")
  };

  const state = {
    catalogLoaded: false,
    subjects: {},
    topics: {},
    records: [],
    visibleRecords: [],
    selected: new Map(),
    loading: false
  };

  async function apiRequest(path) {
    const response = await fetch(`${API}${path}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error("Invalid server response.");
    }

    if (!response.ok || !data.success) {
      throw new Error(data.error || `Request failed (${response.status}).`);
    }

    return data;
  }

  async function verifyAdmin() {
    const data = await apiRequest("/api/auth/session");

    if (!data.user || data.user.role !== "admin") {
      throw new Error("Administrator access required. Please sign in.");
    }

    return data.user;
  }

  function addOption(select, value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  function showListMessage(title, description) {
    el.list.replaceChildren();

    const box = document.createElement("div");
    box.className = "empty-state ig-list-status";

    const heading = document.createElement("strong");
    heading.textContent = title;

    const message = document.createElement("p");
    message.textContent = description;

    box.append(heading, message);
    el.list.appendChild(box);

    state.visibleRecords = [];
    updateSelectionUI();
  }

  async function loadCatalog() {
    await verifyAdmin();

    const data = await apiRequest("/api/db/catalog");

    const catalog = data.catalog || {};

    state.subjects = catalog.subjects || {};
    state.topics = catalog.topics || {};

    el.subject.replaceChildren();
    addOption(el.subject, "", "Select Subject");

    const subjects = Object.entries(state.subjects)
      .filter(([, item]) => item && item.active !== false)
      .sort((a, b) =>
        String(a[1].name || a[0]).localeCompare(
          String(b[1].name || b[0])
        )
      );

    subjects.forEach(([code, item]) => {
      addOption(
        el.subject,
        code,
        `${item.name || code} (${code})`
      );
    });

    el.subject.disabled = subjects.length === 0;
    state.catalogLoaded = true;

    if (!subjects.length) {
      showListMessage(
        "No Active Subjects",
        "Create or activate a subject in Database Management first."
      );
    }
  }

  function populateTopics(subjectCode) {
    el.topic.replaceChildren();
    addOption(el.topic, "", "Select Topic");

    const collection = state.topics[subjectCode] || {};

    const topics = Object.entries(collection)
      .filter(([, item]) => item && item.active !== false)
      .sort((a, b) =>
        String(a[1].name || a[0]).localeCompare(
          String(b[1].name || b[0])
        )
      );

    topics.forEach(([code, item]) => {
      addOption(
        el.topic,
        code,
        `${item.name || code} (${code})`
      );
    });

    el.topic.disabled = topics.length === 0;
  }

  function searchableText(record) {
    return [
      record.id,
      record.type,
      record.question?.en,
      record.question?.as,
      record.answer?.en,
      record.answer?.as
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function getVisibleRecords() {
    const search = el.search.value.trim().toLowerCase();

    return state.records.filter(record =>
      !search || searchableText(record).includes(search)
    );
  }

  function updateSelectionUI() {
    const total = state.selected.size;

    el.count.textContent =
      `${total} selected`;

    const visible = state.visibleRecords;

    el.selectAll.checked =
      visible.length > 0 &&
      visible.every(record => state.selected.has(record.id));

    el.selectAll.indeterminate =
      visible.some(record => state.selected.has(record.id)) &&
      !el.selectAll.checked;
  }

  function createQuestionCard(record) {
    const card = document.createElement("article");
    card.className = "ig-question-item";

    const label = document.createElement("label");
    label.className = "ig-question-select";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.questionId = record.id;
    checkbox.checked = state.selected.has(record.id);

    const body = document.createElement("div");
    body.className = "ig-question-content";

    const meta = document.createElement("div");
    meta.className = "ig-question-meta";

    const type = document.createElement("span");
    type.className = "ig-type-tag";
    type.textContent = record.type || "Question";

    const id = document.createElement("code");
    id.className = "ig-question-id";
    id.textContent = record.id || "—";

    meta.append(type, id);

    const english = document.createElement("div");
    english.className = "ig-question-text";
    english.textContent = record.question?.en || "—";

    const assamese = document.createElement("div");
    assamese.className = "ig-question-assamese";
    assamese.textContent = record.question?.as || "";

    body.append(meta, english);

    if (assamese.textContent) {
      body.appendChild(assamese);
    }

    label.append(checkbox, body);
    card.appendChild(label);

    return card;
  }

  function renderQuestions() {
    const records = getVisibleRecords();

    state.visibleRecords = records;
    el.list.replaceChildren();

    if (!records.length) {
      showListMessage(
        "No Matching Questions",
        "Try another search or change your question filters."
      );
      return;
    }

    const fragment = document.createDocumentFragment();

    records.forEach(record => {
      fragment.appendChild(createQuestionCard(record));
    });

    el.list.appendChild(fragment);
    updateSelectionUI();
  }

  async function loadQuestions() {
    if (state.loading) return;

    if (!el.subject.value || !el.topic.value) {
      showListMessage(
        "Select Subject and Topic",
        "Both selections are required before loading questions."
      );
      return;
    }

    state.loading = true;
    el.load.disabled = true;
    el.load.textContent = "Loading...";

    showListMessage(
      "Loading Questions",
      "Fetching active questions from your database."
    );

    try {
      await verifyAdmin();

      const params = new URLSearchParams({
        subjectCode: el.subject.value,
        topicCode: el.topic.value
      });

      if (el.type.value) {
        params.set("type", el.type.value);
      }

      const data = await apiRequest(
        `/api/admin/questions?${params.toString()}`
      );

      state.records = Array.isArray(data.questions)
        ? data.questions.filter(record =>
            record &&
            record.id &&
            record.active !== false
          )
        : [];

      // Refresh selected snapshots without changing selection order.
      state.records.forEach(record => {
        if (state.selected.has(record.id)) {
          state.selected.set(record.id, record);
        }
      });

      renderQuestions();

    } catch (error) {
      showListMessage(
        "Unable to Load Questions",
        error.message || "Please try again."
      );

    } finally {
      state.loading = false;
      el.load.disabled = false;
      el.load.textContent = "Load Questions";
    }
  }

  el.subject.addEventListener("change", () => {
    populateTopics(el.subject.value);

    state.records = [];
    showListMessage(
      "Select a Topic",
      "Choose a topic and load its questions."
    );
  });

  el.load.addEventListener("click", loadQuestions);

  el.search.addEventListener("input", renderQuestions);

  el.type.addEventListener("change", () => {
    if (el.subject.value && el.topic.value) {
      loadQuestions();
    }
  });

  el.list.addEventListener("change", event => {
    const checkbox = event.target.closest(
      "input[data-question-id]"
    );

    if (!checkbox) return;

    const record = state.visibleRecords.find(
      item => item.id === checkbox.dataset.questionId
    );

    if (!record) return;

    if (checkbox.checked) {
      state.selected.set(record.id, record);
    } else {
      state.selected.delete(record.id);
    }

    updateSelectionUI();
  });

  el.selectAll.addEventListener("change", () => {
    state.visibleRecords.forEach(record => {
      if (el.selectAll.checked) {
        state.selected.set(record.id, record);
      } else {
        state.selected.delete(record.id);
      }
    });

    renderQuestions();
  });

  el.clear.addEventListener("click", () => {
    state.selected.clear();
    renderQuestions();
  });

  async function initialize() {
    if (state.catalogLoaded) return;

    try {
      showListMessage(
        "Connecting to Database",
        "Verifying administrator access."
      );

      await loadCatalog();

      if (!Object.keys(state.subjects).length) return;

      showListMessage(
        "Database Connected",
        "Select a subject and topic to load questions."
      );

    } catch (error) {
      showListMessage(
        "Database Access Unavailable",
        error.message
      );
    }
  }

  window.addEventListener(
    "preparekora:authenticated",
    initialize
  );

  document.getElementById("dashboard-preview")
    .addEventListener("change", event => {
      if (event.target.checked) initialize();
    });

  // Expose selected records for the upcoming image renderer.
  window.prepareKoraImageWorkspace = {
    getSelectedQuestions: () => [
      ...state.selected.values()
    ],
    getSelectedQuestionIds: () => [
      ...state.selected.keys()
    ]
  };

})();
