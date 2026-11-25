
"use strict";

/* =========================================
   PREPAREKORA — DATABASE MANAGEMENT
   Backend: Cloudflare Worker
   Storage: Firebase Realtime Database
   ========================================= */

const API_BASE =
  "https://preparekora-studio-api.yadavsubba2003.workers.dev";

const PAGE_SIZE = 10;
const INDIA_TIMEZONE = "Asia/Kolkata";

// DOM references
const elements = {
  layout: document.getElementById("adminLayout"),
  sidebar: document.getElementById("sidebar"),
  sidebarToggle: document.getElementById("sidebarToggle"),

  subject: document.getElementById("subjectFilter"),
  topic: document.getElementById("topicFilter"),
  type: document.getElementById("typeFilter"),
  keyword: document.getElementById("keywordFilter"),
  dateFrom: document.getElementById("dateFrom"),
  dateTo: document.getElementById("dateTo"),

  form: document.getElementById("databaseFilters"),
  refresh: document.getElementById("refreshButton"),
  reset: document.getElementById("resetFiltersButton"),
  export: document.getElementById("exportCsvButton"),

  table: document.querySelector(".database-table"),
  tableBody: document.getElementById("recordsBody"),
  emptyState: document.getElementById("emptyState"),

  recordCount: document.getElementById("recordCount"),
  paginationInfo: document.getElementById("paginationInfo"),
  pageIndicator: document.getElementById("pageIndicator"),
  previousPage: document.getElementById("previousPage"),
  nextPage: document.getElementById("nextPage"),

  message: document.getElementById("databaseMessage")
};

// Application state
const state = {
  catalog: null,
  subjects: {},
  topics: {},
  allRecords: [],
  filteredRecords: [],
  currentPage: 1,
  filtersDirty: true,
  loading: false
};


/* =========================================
   API HELPERS
   ========================================= */

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...options
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("Invalid server response.");
  }

  if (!response.ok || !data.success) {
    throw new Error(
      data.error || `Request failed (${response.status})`
    );
  }

  return data;
}


/* =========================================
   MESSAGE HANDLING
   ========================================= */

function showMessage(type, message) {
  elements.message.className = `database-message ${type}`;
  elements.message.textContent = message;
}

function clearMessage() {
  elements.message.className = "database-message";
  elements.message.textContent = "";
}


/* =========================================
   AUTHENTICATION
   ========================================= */

async function verifyAdminSession() {
  const data = await apiRequest("/api/auth/session");

  if (!data.user || data.user.role !== "admin") {
    throw new Error("Administrator access required.");
  }

  return data.user;
}


/* =========================================
   LOAD SUBJECTS AND TOPICS
   ========================================= */

async function loadCatalog() {
  const data = await apiRequest("/api/db/catalog");

  state.catalog = data.catalog || {};

  state.subjects = state.catalog.subjects || {};
  state.topics = state.catalog.topics || {};

  populateSubjects();
}

function populateSubjects() {
  elements.subject.replaceChildren();

  addOption(
    elements.subject,
    "",
    "Select Subject"
  );

  const subjects = Object.entries(state.subjects)
    .filter(([code, subject]) =>
      subject &&
      subject.active !== false
    )
    .sort((a, b) =>
      String(a[1].name || a[0])
        .localeCompare(String(b[1].name || b[0]))
    );

  subjects.forEach(([code, subject]) => {
    addOption(
      elements.subject,
      code,
      `${subject.name || code} (${code})`
    );
  });

  elements.subject.disabled = subjects.length === 0;
}

function populateTopics(subjectCode) {
  elements.topic.replaceChildren();

  addOption(
    elements.topic,
    "",
    "Select Topic"
  );

  const topicCollection = state.topics[subjectCode] || {};

  const topics = Object.entries(topicCollection)
    .filter(([code, topic]) =>
      topic &&
      topic.active !== false
    )
    .sort((a, b) =>
      String(a[1].name || a[0])
        .localeCompare(String(b[1].name || b[0]))
    );

  topics.forEach(([code, topic]) => {
    addOption(
      elements.topic,
      code,
      `${topic.name || code} (${code})`
    );
  });

  elements.topic.disabled = topics.length === 0;
}

function addOption(select, value, label) {
  const option = document.createElement("option");

  option.value = value;
  option.textContent = label;

  select.appendChild(option);
}


/* =========================================
   FILTER VALIDATION
   ========================================= */

function getCurrentFilters() {
  return {
    subjectCode: elements.subject.value,
    topicCode: elements.topic.value,
    type: elements.type.value,
    keyword: elements.keyword.value.trim().toLowerCase(),
    dateFrom: elements.dateFrom.value,
    dateTo: elements.dateTo.value
  };
}

function validateFilters(filters) {
  if (!filters.subjectCode || !filters.topicCode) {
    throw new Error("Please select a Subject and Topic.");
  }

  if (
    filters.dateFrom &&
    filters.dateTo &&
    filters.dateFrom > filters.dateTo
  ) {
    throw new Error("Invalid date range.");
  }
}


/* =========================================
   LOAD QUESTIONS FROM WORKER
   ========================================= */

async function loadRecords() {
  if (state.loading) return;

  const filters = getCurrentFilters();

  try {
    validateFilters(filters);
  } catch (error) {
    showMessage("error", error.message);
    return;
  }

  state.loading = true;
  state.filtersDirty = true;

  updateLoadingState(true);
  clearMessage();

  try {
    const params = new URLSearchParams({
      subjectCode: filters.subjectCode,
      topicCode: filters.topicCode
    });

    if (filters.type) {
      params.set("type", filters.type);
    }

    const data = await apiRequest(
      `/api/admin/questions?${params.toString()}`
    );

    state.allRecords = Array.isArray(data.questions)
      ? data.questions
      : [];

    applyLocalFilters(filters);

    state.currentPage = 1;
    state.filtersDirty = false;

    renderDatabase();

    showMessage(
      "success",
      `${state.filteredRecords.length} matching records loaded successfully.`
    );

  } catch (error) {
    state.filtersDirty = true;
    elements.export.disabled = true;

    showMessage(
      "error",
      error.message || "Unable to load database records."
    );

  } finally {
    state.loading = false;
    updateLoadingState(false);
  }
}


/* =========================================
   LOCAL FILTERING
   Search and date filters are applied to
   the records returned by the Worker.
   ========================================= */

function getSearchableText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return Object.values(value)
      .map(getSearchableText)
      .join(" ");
  }

  return String(value);
}

function getIndiaDate(timestamp) {
  if (!timestamp) return "";

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en", {
    timeZone: INDIA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = parts.find(p => p.type === "year").value;
  const month = parts.find(p => p.type === "month").value;
  const day = parts.find(p => p.type === "day").value;

  return `${year}-${month}-${day}`;
}

function applyLocalFilters(filters) {
  state.filteredRecords = state.allRecords.filter(record => {
    if (!record) return false;

    // Keyword filter
    if (filters.keyword) {
      const searchable = getSearchableText(record).toLowerCase();

      if (!searchable.includes(filters.keyword)) {
        return false;
      }
    }

    // Date filter
    const createdDate = getIndiaDate(record.createdAt);

    if (filters.dateFrom) {
      if (!createdDate || createdDate < filters.dateFrom) {
        return false;
      }
    }

    if (filters.dateTo) {
      if (!createdDate || createdDate > filters.dateTo) {
        return false;
      }
    }

    return true;
  });
}


/* =========================================
   DATABASE TABLE RENDERING
   ========================================= */

function renderDatabase() {
  elements.recordCount.textContent =
    `${state.filteredRecords.length} Records`;

  elements.tableBody.replaceChildren();

  const hasRecords = state.filteredRecords.length > 0;

  elements.table.hidden = !hasRecords;
  elements.emptyState.hidden = hasRecords;

  if (!hasRecords) {
    const heading = elements.emptyState.querySelector("h3");
    const paragraph = elements.emptyState.querySelector("p");

    heading.textContent = "No Matching Records";

    paragraph.textContent =
      "No questions match the selected database filters.";

    elements.export.disabled = true;

    updatePagination();
    return;
  }

  elements.export.disabled =
    state.filtersDirty || state.loading;

  const start = (state.currentPage - 1) * PAGE_SIZE;

  const pageRecords = state.filteredRecords.slice(
    start,
    start + PAGE_SIZE
  );

  pageRecords.forEach(record => {
    elements.tableBody.appendChild(createRecordRow(record));
  });

  updatePagination();
}

function createRecordRow(record) {
  const row = document.createElement("tr");

  // Question ID
  row.appendChild(createCell(record.id || "—"));

  // Question type
  const typeCell = document.createElement("td");
  const typeBadge = document.createElement("span");

  typeBadge.className = "type-badge";
  typeBadge.textContent = record.type || "—";

  typeCell.appendChild(typeBadge);
  row.appendChild(typeCell);

  // Bilingual question
  const questionCell = document.createElement("td");

  const english = document.createElement("div");
  english.textContent = record.question?.en || "—";
  english.style.fontWeight = "600";

  const assamese = document.createElement("div");
  assamese.textContent = record.question?.as || "";
  assamese.style.marginTop = "4px";
  assamese.style.color = "#737b88";

  questionCell.append(english, assamese);

  row.appendChild(questionCell);

  // Subject
  const subject = state.subjects[record.subjectCode];

  row.appendChild(
    createCell(
      subject?.name || record.subjectCode || "—"
    )
  );

  // Topic
  const topic = state.topics[record.subjectCode]?.[record.topicCode];

  row.appendChild(
    createCell(
      topic?.name || record.topicCode || "—"
    )
  );

  // Creation date
  row.appendChild(
    createCell(formatDate(record.createdAt))
  );

  // Status
  const statusCell = document.createElement("td");
  const statusBadge = document.createElement("span");

  const active = record.active !== false;

  statusBadge.className =
    `status-badge ${active ? "active" : "inactive"}`;

  statusBadge.textContent = active ? "Active" : "Inactive";

  statusCell.appendChild(statusBadge);
  row.appendChild(statusCell);

  // Actions will be connected in a later stage.
  row.appendChild(createCell("—"));

  return row;
}

function createCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  return cell;
}

function formatDate(timestamp) {
  if (!timestamp) return "—";

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: INDIA_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}


/* =========================================
   PAGINATION
   ========================================= */

function updatePagination() {
  const total = state.filteredRecords.length;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const currentPage = total
    ? state.currentPage
    : 0;

  const start = total
    ? (state.currentPage - 1) * PAGE_SIZE + 1
    : 0;

  const end = total
    ? Math.min(state.currentPage * PAGE_SIZE, total)
    : 0;

  elements.paginationInfo.textContent =
    total
      ? `Showing ${start}–${end} of ${total} records`
      : "No records available";

  elements.pageIndicator.textContent =
    `Page ${currentPage} of ${totalPages}`;

  elements.previousPage.disabled =
    !total || state.currentPage <= 1;

  elements.nextPage.disabled =
    !total || state.currentPage >= totalPages;
}

function changePage(direction) {
  if (state.filtersDirty) return;

  const totalPages = Math.ceil(
    state.filteredRecords.length / PAGE_SIZE
  );

  const nextPage = state.currentPage + direction;

  if (nextPage < 1 || nextPage > totalPages) {
    return;
  }

  state.currentPage = nextPage;
  renderDatabase();
}


/* =========================================
   CSV EXPORT
   Exports all filtered records, not only
   the currently visible pagination page.
   ========================================= */

function csvCell(value) {
  let text = value === null || value === undefined
    ? ""
    : String(value);

  // Protect spreadsheet applications from
  // interpreting imported text as formulas.
  if (/^[\s]*[=+\-@]/.test(text)) {
    text = "'" + text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(records) {
  const columns = [
    "Question ID",
    "Type",
    "Set Number",
    "Serial Number",
    "Subject Code",
    "Subject Name",
    "Topic Code",
    "Topic Name",

    "Question English",
    "Question Assamese",

    "Answer English",
    "Answer Assamese",

    "Option A English",
    "Option A Assamese",
    "Option B English",
    "Option B Assamese",
    "Option C English",
    "Option C Assamese",
    "Option D English",
    "Option D Assamese",

    "Correct Option",

    "Explanation English",
    "Explanation Assamese",

    "Status",
    "Created At",
    "Updated At",
    "Created By"
  ];

  const rows = [columns];

  records.forEach(record => {
    const subject = state.subjects[record.subjectCode];
    const topic = state.topics[record.subjectCode]?.[record.topicCode];

    const options = record.options || {};
    const answer = record.answer || {};
    const question = record.question || {};
    const explanation = record.explanation || {};

    rows.push([
      record.id,
      record.type,
      record.setNumber,
      record.serialNumber,

      record.subjectCode,
      subject?.name || "",

      record.topicCode,
      topic?.name || "",

      question.en,
      question.as,

      answer.en,
      answer.as,

      options.A?.en,
      options.A?.as,
      options.B?.en,
      options.B?.as,
      options.C?.en,
      options.C?.as,
      options.D?.en,
      options.D?.as,

      record.correctOption,

      explanation.en,
      explanation.as,

      record.active === false ? "Inactive" : "Active",

      record.createdAt,
      record.updatedAt,
      record.createdBy
    ]);
  });

  return rows
    .map(row => row.map(csvCell).join(","))
    .join("\r\n");
}

function exportCsv() {
  if (
    state.loading ||
    state.filtersDirty ||
    !state.filteredRecords.length
  ) {
    showMessage(
      "info",
      "Apply your filters and load records before exporting."
    );
    return;
  }

  try {
    const csv = "\uFEFF" + buildCsv(state.filteredRecords);

    const blob = new Blob(
      [csv],
      { type: "text/csv;charset=utf-8;" }
    );

    const downloadUrl = URL.createObjectURL(blob);

    const anchor = document.createElement("a");

    const filters = getCurrentFilters();

    const today = getIndiaDate(new Date().toISOString())
      .replace(/-/g, "");

    anchor.href = downloadUrl;

    anchor.download =
      `PrepareKora_Database_${filters.subjectCode}_${filters.topicCode}_${today}.csv`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    URL.revokeObjectURL(downloadUrl);

    showMessage(
      "success",
      `${state.filteredRecords.length} filtered records exported successfully.`
    );

  } catch (error) {
    console.error("CSV_EXPORT_ERROR:", error);

    showMessage(
      "error",
      "CSV export failed. Please try again."
    );
  }
}


/* =========================================
   FILTER STATE
   ========================================= */

function markFiltersChanged() {
  state.filtersDirty = true;
  elements.export.disabled = true;

  if (state.filteredRecords.length) {
    showMessage(
      "info",
      "Filters changed. Apply Filters to load updated records before exporting."
    );
  }
}

function clearDatabase() {
  state.allRecords = [];
  state.filteredRecords = [];
  state.currentPage = 1;

  elements.tableBody.replaceChildren();
  elements.table.hidden = true;
  elements.emptyState.hidden = false;

  elements.emptyState.querySelector("h3").textContent =
    "No Records Loaded";

  elements.emptyState.querySelector("p").textContent =
    "Select a subject and topic, then apply filters to view database records.";

  elements.recordCount.textContent = "0 Records";

  elements.export.disabled = true;

  updatePagination();
}


/* =========================================
   REFRESH AND LOADING STATES
   ========================================= */

function updateLoadingState(loading) {
  elements.refresh.disabled = loading;
  elements.form.querySelector('button[type="submit"]').disabled = loading;
  elements.export.disabled = loading || state.filtersDirty ||
    !state.filteredRecords.length;

  elements.refresh.textContent =
    loading ? "Loading..." : "Refresh Data";
}


/* =========================================
   SIDEBAR
   ========================================= */

function setSidebarOpen(open) {
  elements.layout.classList.toggle("sidebar-open", open);

  elements.sidebarToggle.setAttribute(
    "aria-expanded",
    String(open)
  );
}

elements.sidebarToggle.addEventListener("click", () => {
  const open = !elements.layout.classList.contains("sidebar-open");

  setSidebarOpen(open);
});

elements.layout.addEventListener("click", event => {
  if (
    elements.layout.classList.contains("sidebar-open") &&
    event.target === elements.layout
  ) {
    setSidebarOpen(false);
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    setSidebarOpen(false);
  }
});


/* =========================================
   EVENT LISTENERS
   ========================================= */

// Subject selection
elements.subject.addEventListener("change", () => {
  populateTopics(elements.subject.value);

  markFiltersChanged();
});

// All other filters
[
  elements.topic,
  elements.type,
  elements.keyword,
  elements.dateFrom,
  elements.dateTo
].forEach(element => {
  element.addEventListener("input", markFiltersChanged);
  element.addEventListener("change", markFiltersChanged);
});

// Apply filters
elements.form.addEventListener("submit", event => {
  event.preventDefault();
  loadRecords();
});

// Reset filters
elements.form.addEventListener("reset", event => {
  event.preventDefault();

  elements.subject.value = "";
  populateTopics("");

  elements.type.value = "";
  elements.keyword.value = "";
  elements.dateFrom.value = "";
  elements.dateTo.value = "";

  state.filtersDirty = true;

  clearDatabase();
  clearMessage();
});

// Refresh
elements.refresh.addEventListener("click", async () => {
  if (elements.subject.value && elements.topic.value) {
    await loadRecords();
    return;
  }

  try {
    await loadCatalog();
    clearMessage();
    showMessage("success", "Catalog refreshed successfully.");
  } catch (error) {
    showMessage("error", error.message);
  }
});

// Pagination
elements.previousPage.addEventListener("click", () => {
  changePage(-1);
});

elements.nextPage.addEventListener("click", () => {
  changePage(1);
});

// CSV Export
elements.export.addEventListener("click", exportCsv);


/* =========================================
   INITIALIZATION
   ========================================= */

async function initializeDatabase() {
  clearDatabase();
  updateLoadingState(false);

  try {
    showMessage("info", "Verifying administrator session...");

    await verifyAdminSession();

    showMessage("info", "Loading database catalog...");

    await loadCatalog();

    clearMessage();

    if (elements.subject.disabled) {
      showMessage(
        "info",
        "No active subjects are available in the catalog."
      );
    }

  } catch (error) {
    console.error("DATABASE_INITIALIZATION_ERROR:", error);

    showMessage(
      "error",
      error.message || "Database initialization failed."
    );

    elements.subject.disabled = true;
    elements.topic.disabled = true;
    elements.form.querySelector('button[type="submit"]').disabled = true;
    elements.refresh.disabled = true;
    elements.export.disabled = true;
  }
}

initializeDatabase();
