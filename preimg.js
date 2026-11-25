/* =========================================
   PREPAREKORA STUDIO
   Bilingual question -> image workspace
   ========================================= */
(() => {
  "use strict";

  const API = "https://preparekora-studio-api.yadavsubba2003.workers.dev";
  const $ = (id) => document.getElementById(id);
  const state = {
    user: null,
    catalog: { subjects: {}, topics: {} },
    drafts: [],
    pages: [],
    background: "#fafbfc",
    generating: false,
    catalogMode: "subject",
    objectUrls: []
  };

  const el = {
    loginView: $("loginView"), appView: $("appView"),
    loginForm: $("loginForm"), loginEmail: $("loginEmail"), loginPassword: $("loginPassword"),
    loginButton: $("loginButton"), loginFeedback: $("loginFeedback"),
    accountEmail: $("accountEmail"), logout: $("logoutButton"),
    subject: $("subjectSelect"), topic: $("topicSelect"), inputMode: $("inputMode"),
    addSubject: $("addSubjectButton"), addTopic: $("addTopicButton"),
    draft: $("draftInput"),
    clear: $("clearButton"), copyFormat: $("copyFormatButton"),
    draftFeedback: $("draftFeedback"), parsedArea: $("parsedArea"),
    parsedSummary: $("parsedSummary"), parsedList: $("parsedList"),
    ratio: $("ratioSelect"), heading: $("imageHeading"), brand: $("brandName"),
    swatches: $("backgroundSwatches"), customBg: $("customBackground"),
    bgValue: $("backgroundValue"), radius: $("radiusRange"), radiusValue: $("radiusValue"),
    qr: $("qrUrl"), generate: $("generateButton"), generateHint: $("generateHint"),
    generated: $("generatedPages"), generatedSummary: $("generatedSummary"),
    generationFeedback: $("generationFeedback"), zip: $("downloadZipButton"),
    history: $("historyList"), refreshHistory: $("refreshHistoryButton"),
    catalogDialog: $("catalogDialog"), catalogForm: $("catalogForm"),
    catalogTitle: $("catalogTitle"), catalogCodeGroup: $("catalogCodeGroup"),
    catalogCode: $("catalogCode"), catalogNameLabel: $("catalogNameLabel"),
    catalogName: $("catalogName"), catalogDescription: $("catalogDescription"),
    catalogFeedback: $("catalogFeedback"), catalogSave: $("saveCatalogButton"),
    catalogClose: $("closeCatalogDialog"), catalogCancel: $("cancelCatalogButton")
  };

  const BG_PRESETS = [
    ["Original", "#fafbfc"], ["Pure white", "#ffffff"], ["Cool grey", "#f1f5f9"],
    ["Soft grey", "#f8fafc"], ["Warm cream", "#fffaf0"], ["Ivory", "#fefce8"],
    ["Mint", "#f0fdf4"], ["Ice blue", "#eff6ff"], ["Lavender", "#faf5ff"],
    ["Blush", "#fff1f2"]
  ];

  const DIMENSIONS = {
    "4:5": { width: 1080, height: 1350 },
    "1:1": { width: 1080, height: 1080 },
    "4:3": { width: 1440, height: 1080 },
    "9:16": { width: 1080, height: 1920 },
    "16:9": { width: 1920, height: 1080 }
  };

  function setFeedback(target, message, kind = "") {
    target.textContent = message || "";
    target.className = `feedback${kind ? ` ${kind}` : ""}`;
  }

  async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      credentials: "include",
      cache: "no-store",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error("The server returned an invalid response."); }
    if (!response.ok || !data.success) {
      throw new Error(data.error || `Request failed (${response.status}).`);
    }
    return data;
  }

  async function verifyAdmin() {
    const data = await api("/api/auth/session");
    if (!data.user || data.user.role !== "admin") {
      throw new Error("Administrator access required. Sign in with the admin account.");
    }
    state.user = data.user;
    return data.user;
  }

  function showWorkspace(user) {
    state.user = user;
    el.loginView.hidden = true;
    el.appView.hidden = false;
    el.accountEmail.textContent = user.email || "Administrator";
    initializeRevealAnimations();
    loadCatalog().catch(error => setFeedback(el.generationFeedback, error.message, "error"));
  }

  async function login(event) {
    event.preventDefault();
    el.loginButton.disabled = true;
    el.loginButton.textContent = "Signing in...";
    setFeedback(el.loginFeedback, "Verifying administrator account...");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: el.loginEmail.value.trim(),
          password: el.loginPassword.value
        })
      });
      const user = await verifyAdmin();
      showWorkspace(user);
      el.loginPassword.value = "";
    } catch (error) {
      await fetch(`${API}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
      setFeedback(el.loginFeedback, error.message, "error");
    } finally {
      el.loginButton.disabled = false;
      el.loginButton.textContent = "Sign in";
    }
  }

  async function logout() {
    el.logout.disabled = true;
    try { await api("/api/auth/logout", { method: "POST" }); }
    catch { /* Clear the local view even if the network is unavailable. */ }
    state.user = null;
    el.appView.hidden = true;
    el.loginView.hidden = false;
    el.logout.disabled = false;
  }

  function addOption(select, value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  async function loadCatalog(preferredSubject = "") {
    await verifyAdmin();
    const data = await api("/api/db/catalog");
    state.catalog = data.catalog || { subjects: {}, topics: {} };
    state.catalog.subjects ||= {};
    state.catalog.topics ||= {};

    el.subject.replaceChildren();
    addOption(el.subject, "", "Select subject");
    const subjects = Object.entries(state.catalog.subjects)
      .filter(([, item]) => item && item.active !== false)
      .sort((a, b) => String(a[1].name || a[0]).localeCompare(String(b[1].name || b[0])));
    subjects.forEach(([code, item]) => addOption(el.subject, code, `${item.name || code} (${code})`));
    el.subject.disabled = subjects.length === 0;
    if (preferredSubject && state.catalog.subjects[preferredSubject]) el.subject.value = preferredSubject;
    if (el.subject.value) populateTopics(el.subject.value);
    else {
      el.topic.replaceChildren();
      addOption(el.topic, "", "Select topic");
      el.topic.disabled = true;
    }
    el.addTopic.disabled = !el.subject.value;
    if (el.subject.value) loadHistory().catch(() => {});
  }

  function populateTopics(subjectCode, preferredTopic = "") {
    el.topic.replaceChildren();
    addOption(el.topic, "", "Select topic");
    const topics = Object.entries(state.catalog.topics[subjectCode] || {})
      .filter(([, item]) => item && item.active !== false)
      .sort((a, b) => String(a[1].name || a[0]).localeCompare(String(b[1].name || b[0])));
    topics.forEach(([code, item]) => addOption(el.topic, code, `${item.name || code} (${code})`));
    el.topic.disabled = topics.length === 0;
    if (preferredTopic && state.catalog.topics[subjectCode]?.[preferredTopic]) el.topic.value = preferredTopic;
    el.addTopic.disabled = !subjectCode;
    if (!el.heading.value && el.topic.value) el.heading.value = topics.find(([code]) => code === el.topic.value)?.[1]?.name || "";
  }

  function openCatalogDialog(mode) {
    state.catalogMode = mode;
    const subjectMode = mode === "subject";
    el.catalogTitle.textContent = subjectMode ? "Add subject" : "Add topic";
    el.catalogCodeGroup.hidden = !subjectMode;
    el.catalogCode.required = subjectMode;
    el.catalogCode.value = "";
    el.catalogName.value = "";
    el.catalogDescription.value = "";
    el.catalogNameLabel.textContent = subjectMode ? "Subject name" : "Topic name";
    setFeedback(el.catalogFeedback, "");
    if (!subjectMode && !el.subject.value) return;
    el.catalogDialog.showModal();
  }

  async function saveCatalogItem(event) {
    event.preventDefault();
    const subjectMode = state.catalogMode === "subject";
    const name = el.catalogName.value.trim();
    const description = el.catalogDescription.value.trim();
    if (name.length < 2) return setFeedback(el.catalogFeedback, "Enter a name with at least 2 characters.", "error");
    el.catalogSave.disabled = true;
    el.catalogSave.textContent = "Saving...";
    try {
      let result;
      if (subjectMode) {
        const code = el.catalogCode.value.trim().toUpperCase();
        if (!/^[A-Z0-9_-]{2,12}$/.test(code)) throw new Error("Use 2–12 letters, numbers, hyphens or underscores for the subject code.");
        result = await api("/api/admin/catalog/subjects", {
          method: "POST", body: JSON.stringify({ code, name, description })
        });
        await loadCatalog(code);
      } else {
        result = await api("/api/admin/catalog/topics", {
          method: "POST", body: JSON.stringify({ subjectCode: el.subject.value, name, description })
        });
        await loadCatalog(el.subject.value);
        if (result.topic?.code) el.topic.value = result.topic.code;
      }
      el.catalogDialog.close();
      setFeedback(el.generationFeedback, subjectMode ? "Subject added." : `Topic added (${result.topic?.code || "created"}).`, "success");
    } catch (error) {
      setFeedback(el.catalogFeedback, error.message, "error");
    } finally {
      el.catalogSave.disabled = false;
      el.catalogSave.textContent = "Save";
    }
  }

  function splitBilingual(value) {
    const text = String(value || "").trim();
    const splitAt = text.lastIndexOf(" (");
    if (splitAt > 0 && text.endsWith(")")) {
      return { en: text.slice(0, splitAt).trim(), as: text.slice(splitAt + 2, -1).trim() };
    }
    return { en: text, as: "" };
  }

  function parseBlocks(source) {
    const lines = source.replace(/\r/g, "").split("\n");
    const blocks = [];
    let current = null;
    let activeField = "";
    const finish = () => {
      if (current && (current.question || Object.keys(current.options).length || current.answer)) blocks.push(current);
      current = null;
      activeField = "";
    };
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (/^-{3,}$/.test(line)) { finish(); continue; }
      const qMatch = line.match(/^Q\s*:\s*(.*)$/i);
      if (qMatch) {
        finish();
        current = { question: qMatch[1], answer: "", explanation: "", options: {} };
        activeField = "question";
        continue;
      }
      if (!line) continue;
      if (!current) continue;
      let match;
      if ((match = line.match(/^(?:Option\s*)?([A-D])\s*[).:\-]\s*(.*)$/i))) {
        const key = match[1].toUpperCase();
        current.options[key] = match[2];
        activeField = `option:${key}`;
      } else if ((match = line.match(/^(?:Ans|Answer|Correct\s+(?:Ans|Answer|Option))\s*:\s*(.*)$/i))) {
        current.answer = match[1];
        activeField = "answer";
      } else if ((match = line.match(/^Explanation\s*:\s*(.*)$/i))) {
        current.explanation = match[1];
        activeField = "explanation";
      } else if (activeField === "question") current.question += ` ${line}`;
      else if (activeField === "answer") current.answer += ` ${line}`;
      else if (activeField === "explanation") current.explanation += ` ${line}`;
      else if (activeField.startsWith("option:")) current.options[activeField.slice(7)] += ` ${line}`;
    }
    finish();
    return blocks;
  }

  function normalizeDraft(raw, index) {
    const hasOptions = ["A", "B", "C", "D"].some(key => raw.options[key]);
    const answerLooksLikeOption = /^\s*(?:OPTION\s*)?[A-D]\s*$/i.test(raw.answer || "");
    const type = el.inputMode.value === "AUTO" ? ((hasOptions || answerLooksLikeOption) ? "MCQ" : "QA") : el.inputMode.value;
    const draft = {
      index, type,
      question: splitBilingual(raw.question),
      answer: splitBilingual(raw.answer),
      explanation: splitBilingual(raw.explanation),
      options: {}, correctOption: "", errors: [], record: null
    };
    ["A", "B", "C", "D"].forEach(key => { draft.options[key] = splitBilingual(raw.options[key] || ""); });
    if (!draft.question.en || !draft.question.as) draft.errors.push("Question needs English text followed by its Assamese translation in parentheses.");
    if (type === "MCQ") {
      ["A", "B", "C", "D"].forEach(key => {
        if (!draft.options[key].en || !draft.options[key].as) draft.errors.push(`Option ${key} needs English and Assamese text.`);
      });
      const answerMatch = raw.answer.match(/^\s*(?:OPTION\s*)?([A-D])\s*$/i);
      draft.correctOption = answerMatch ? answerMatch[1].toUpperCase() : "";
      if (!draft.correctOption) draft.errors.push("Ans must contain the correct option letter A, B, C or D.");
      if (raw.explanation.trim() && (!draft.explanation.en || !draft.explanation.as)) draft.errors.push("If you include an explanation, provide both languages in parentheses.");
    } else {
      if (!draft.answer.en || !draft.answer.as) draft.errors.push("Q&A answer needs English text followed by Assamese in parentheses.");
      if (raw.explanation.trim() && (!draft.explanation.en || !draft.explanation.as)) draft.errors.push("If you include an explanation, provide both languages in parentheses.");
    }
    return draft;
  }

  function bilingualText(pair) {
    return `${pair.en}${pair.as ? ` (${pair.as})` : ""}`;
  }

  function renderParsed() {
    el.parsedList.replaceChildren();
    const valid = state.drafts.filter(item => item.errors.length === 0).length;
    const invalid = state.drafts.length - valid;
    el.parsedSummary.textContent = `${state.drafts.length} found · ${valid} ready · ${invalid} need correction`;
    state.drafts.forEach(draft => {
      const card = document.createElement("article");
      card.className = `parsed-card${draft.errors.length ? " invalid" : ""}`;
      const top = document.createElement("div"); top.className = "parsed-card-top";
      const label = document.createElement("strong"); label.textContent = `Question ${draft.index} · ${draft.type}`;
      const status = document.createElement("span"); status.className = "parsed-status"; status.textContent = draft.record ? "Saved" : draft.errors.length ? "Needs correction" : "Ready";
      top.append(label, status); card.appendChild(top);
      const question = document.createElement("p"); question.className = "parsed-question"; question.textContent = bilingualText(draft.question); card.appendChild(question);
      if (draft.type === "MCQ") {
        const options = document.createElement("div"); options.className = "parsed-options";
        ["A", "B", "C", "D"].forEach(key => {
          const line = document.createElement("p"); line.textContent = `${key}) ${bilingualText(draft.options[key])}`; options.appendChild(line);
        });
        card.appendChild(options);
        const answer = document.createElement("p"); answer.className = "parsed-answer"; answer.textContent = `Correct answer: ${draft.correctOption || "Not detected"}`; card.appendChild(answer);
      } else {
        const answer = document.createElement("p"); answer.className = "parsed-extra"; answer.textContent = `Answer: ${bilingualText(draft.answer)}`; card.appendChild(answer);
      }
      if (draft.explanation.en || draft.explanation.as) {
        const explanation = document.createElement("p"); explanation.className = "parsed-extra"; explanation.textContent = `Explanation: ${bilingualText(draft.explanation)}`; card.appendChild(explanation);
      }
      if (draft.errors.length) {
        const list = document.createElement("ul"); list.className = "parsed-errors";
        draft.errors.forEach(error => { const li = document.createElement("li"); li.textContent = error; list.appendChild(li); });
        card.appendChild(list);
      }
      if (draft.record?.id) {
        const id = document.createElement("p"); id.className = "parsed-id"; id.textContent = `Saved Question ID: ${draft.record.id}`; card.appendChild(id);
      }
      el.parsedList.appendChild(card);
    });
    el.parsedArea.hidden = state.drafts.length === 0;
    updateGenerateState();
  }

  function parseAndPreview() {
    const rawBlocks = parseBlocks(el.draft.value.trim());
    if (!rawBlocks.length) {
      state.drafts = [];
      renderParsed();
      return setFeedback(el.draftFeedback, "No Q: question blocks found. Use the input format shown above.", "error");
    }
    state.drafts = rawBlocks.map((block, index) => normalizeDraft(block, index + 1));
    renderParsed();
    const invalid = state.drafts.filter(item => item.errors.length).length;
    setFeedback(el.draftFeedback, `${state.drafts.length} question(s) parsed. ${invalid ? `${invalid} need correction.` : "All questions are ready."}`, invalid ? "error" : "success");
  }

  function updateGenerateState() {
    const valid = state.drafts.length > 0 && state.drafts.every(item => item.errors.length === 0);
    const ready = valid && Boolean(el.subject.value) && Boolean(el.topic.value) && !state.generating;
    el.generate.disabled = !ready;
    el.generateHint.textContent = !el.subject.value || !el.topic.value
      ? "Choose a subject and topic first."
      : !valid ? "Correct the highlighted question details to continue."
      : "Questions will be saved and assigned unique IDs before image export.";
  }

  function selectedDimensions() { return DIMENSIONS[el.ratio.value] || DIMENSIONS["4:5"]; }

  function getSettings() {
    const subject = state.catalog.subjects[el.subject.value];
    const topic = state.catalog.topics[el.subject.value]?.[el.topic.value];
    return {
      subjectCode: el.subject.value,
      subjectName: subject?.name || el.subject.value,
      topicCode: el.topic.value,
      topicName: topic?.name || el.topic.value,
      heading: el.heading.value.trim() || topic?.name || subject?.name || "Questions",
      brand: el.brand.value.trim() || "preparekora",
      ratio: el.ratio.value,
      background: state.background,
      borderRadius: Number(el.radius.value),
      qrUrl: el.qr.value.trim(),
      dimensions: selectedDimensions()
    };
  }

  async function saveQuestionDraft(draft) {
    if (draft.record?.id) return draft.record;
    const payload = {
      type: draft.type,
      subjectCode: el.subject.value,
      topicCode: el.topic.value,
      question: draft.question
    };
    if (draft.type === "MCQ") {
      payload.options = draft.options;
      payload.correctOption = draft.correctOption;
      if (draft.explanation.en && draft.explanation.as) payload.explanation = draft.explanation;
    } else {
      payload.answer = draft.answer;
      if (draft.explanation.en && draft.explanation.as) payload.explanation = draft.explanation;
    }
    const result = await api("/api/admin/questions", { method: "POST", body: JSON.stringify(payload) });
    draft.record = result.question;
    return result.question;
  }

  function appendBilingual(parent, className, pair) {
    const wrapper = document.createElement("div"); wrapper.className = className;
    wrapper.appendChild(document.createTextNode(pair.en || ""));
    if (pair.as) {
      const translated = document.createElement("span"); translated.className = "export-as";
      translated.textContent = ` (${pair.as})`; wrapper.appendChild(translated);
    }
    parent.appendChild(wrapper);
    return wrapper;
  }

  function createQuestionItem(record) {
    const item = document.createElement("article"); item.className = "export-item";
    if (record.type === "QA") {
      const q = document.createElement("div"); q.className = "export-row";
      const qLabel = document.createElement("div"); qLabel.className = "export-marker"; qLabel.textContent = "Q";
      q.appendChild(qLabel); appendBilingual(q, "export-text", record.question); item.appendChild(q);
      const a = document.createElement("div"); a.className = "export-row";
      const aLabel = document.createElement("div"); aLabel.className = "export-marker"; aLabel.textContent = "Ans";
      a.appendChild(aLabel); appendBilingual(a, "export-answer", record.answer); item.appendChild(a);
      if (record.explanation?.en || record.explanation?.as) {
        const exp = createExplanation(record.explanation); item.appendChild(exp);
      }
    } else {
      const q = document.createElement("div"); q.className = "export-q-row";
      const qLabel = document.createElement("div"); qLabel.className = "export-marker"; qLabel.textContent = "Q";
      q.appendChild(qLabel); appendBilingual(q, "export-q-text", record.question); item.appendChild(q);
      const options = document.createElement("div"); options.className = "export-options";
      ["A", "B", "C", "D"].forEach(letter => {
        const option = document.createElement("div");
        option.className = `export-option${record.correctOption === letter ? " correct" : ""}`;
        const key = document.createElement("span"); key.className = "export-key"; key.textContent = letter;
        option.appendChild(key);
        const text = document.createElement("span"); text.style.minWidth = "0";
        text.appendChild(document.createTextNode(record.options?.[letter]?.en || ""));
        if (record.options?.[letter]?.as) {
          const as = document.createElement("span"); as.className = "export-as"; as.textContent = ` (${record.options[letter].as})`; text.appendChild(as);
        }
        option.appendChild(text); options.appendChild(option);
      });
      item.appendChild(options);
      if (record.explanation?.en || record.explanation?.as) item.appendChild(createExplanation(record.explanation));
    }
    return item;
  }

  function createExplanation(pair) {
    const exp = document.createElement("div"); exp.className = "export-explanation";
    const label = document.createElement("div"); label.className = "export-exp-label"; label.textContent = "Explanation";
    const en = document.createElement("div"); en.className = "export-exp-text"; en.textContent = pair.en || "";
    exp.append(label, en);
    if (pair.as) {
      const divider = document.createElement("div"); divider.className = "export-exp-divider";
      const as = document.createElement("div"); as.className = "export-exp-text export-as"; as.textContent = pair.as;
      exp.append(divider, as);
    }
    return exp;
  }

  function setFrameMetrics(frame, scale) {
    const px = value => `${Math.max(1, Math.round(value * scale))}px`;
    const metrics = {
      "--frame-pad-y": px(56), "--frame-pad-x": px(64),
      "--header-gap": px(18), "--header-pad-bottom": px(24),
      "--brand-font": px(26), "--subject-font": px(20),
      "--badge-font": px(18), "--badge-min-width": px(140),
      "--badge-pad-y": px(8), "--badge-pad-x": px(14),
      "--list-margin-y": px(28), "--item-gap": px(16),
      "--item-pad-y": px(26), "--item-first-pad-top": px(12),
      "--row-gap": px(24), "--marker-width": px(36),
      "--marker-font": px(24), "--marker-margin-top": px(2),
      "--text-font": px(24), "--options-gap": px(14),
      "--options-margin-left": px(60), "--option-gap": px(14),
      "--option-pad-y": px(14), "--option-pad-x": px(18),
      "--option-font": px(20), "--key-size": px(32),
      "--key-font": px(15), "--explanation-margin-left": px(60),
      "--explanation-pad-y": px(20), "--explanation-pad-x": px(24),
      "--explanation-border": px(5), "--explanation-gap": px(10),
      "--explanation-label-font": px(16), "--explanation-text-font": px(20),
      "--footer-gap": px(18), "--footer-pad-top": px(24),
      "--footer-brand-font": px(20), "--footer-page-font": px(20),
      "--qr-size": px(64), "--qr-inner-size": px(60),
      "--two-column-gap": px(30), "--two-column-inset": px(24),
      "--two-row-gap": px(12)
    };
    Object.entries(metrics).forEach(([name, value]) => frame.style.setProperty(name, value));
  }

  function makeFrame(settings, pageNo, totalPages, records, fitLevel = 0) {
    const width = settings.dimensions.width;
    const height = settings.dimensions.height;
    const aspect = width / height;
    const layout = aspect >= 1.2 ? "landscape" : aspect >= 0.9 ? "square" : "portrait";
    const ratioScale = Math.min(1, width / 1080, height / 1350);
    const fitFactors = [1, 0.95, 0.90, 0.85];
    const layoutScale = Math.max(0.76, ratioScale * fitFactors[fitLevel] || ratioScale);

    const frame = document.createElement("div");
    frame.className = `export-frame export-${layout}`;
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    frame.style.backgroundColor = settings.background;
    frame.style.borderRadius = `${settings.borderRadius}px`;
    frame.dataset.layout = layout;
    frame.dataset.layoutScale = layoutScale.toFixed(3);
    setFrameMetrics(frame, layoutScale);

    const header = document.createElement("header"); header.className = "export-header";
    const brand = document.createElement("div"); brand.className = "export-brand";
    brand.textContent = settings.brand;
    const subject = document.createElement("div"); subject.className = "export-subject";
    subject.textContent = settings.heading;
    const badge = document.createElement("div"); badge.className = "export-badge";
    header.append(brand, subject, badge);

    const list = document.createElement("div");
    list.className = `export-list export-list-${layout}${records.length === 2 ? " export-list-two" : ""}`;
    const footer = document.createElement("footer"); footer.className = "export-footer";
    const footerBrand = document.createElement("div"); footerBrand.className = "export-footer-brand";
    footerBrand.textContent = settings.brand;
    const page = document.createElement("div"); page.className = "export-page-number";
    page.textContent = `${pageNo} / ${totalPages}`;
    const qr = document.createElement("div"); qr.className = "export-qr";
    if (!settings.qrUrl) qr.hidden = true;
    footer.append(footerBrand, page, qr);
    frame.append(header, list, footer);
    return { frame, list, badge, page, qr, records: [...records], width, height, layout, layoutScale };
  }

  function questionRange(records) {
    if (!records.length) return "";
    const first = String(records[0].serialNumber || 1).padStart(3, "0");
    const last = String(records[records.length - 1].serialNumber || records.length).padStart(3, "0");
    return first === last ? first : `${first}–${last}`;
  }

  function overflows(page) {
    return page.list.scrollHeight > page.list.clientHeight + 1;
  }

  function makeStage() {
    const stage = document.createElement("div"); stage.className = "render-stage";
    document.body.appendChild(stage); return stage;
  }

  async function buildPages(records, settings) {
    await document.fonts.ready;
    const stage = makeStage();
    const pages = [];
    let currentRecords = [];
    let currentPage = null;

    function fitPage(pageRecords, pageNo) {
      for (let fitLevel = 0; fitLevel < 4; fitLevel++) {
        const candidate = makeFrame(settings, pageNo, 1, pageRecords, fitLevel);
        stage.appendChild(candidate.frame);
        pageRecords.forEach(record => candidate.list.appendChild(createQuestionItem(record)));
        if (!overflows(candidate)) return candidate;
        candidate.frame.remove();
      }
      return null;
    }

    try {
      for (const record of records) {
        // Never place more than two questions on one standalone image.
        const candidateRecords = [...currentRecords, record];
        if (candidateRecords.length <= 2) {
          const candidatePage = fitPage(candidateRecords, pages.length + 1);
          if (candidatePage) {
            if (currentPage) currentPage.frame.remove();
            currentPage = candidatePage;
            currentRecords = candidateRecords;
            continue;
          }
        }

        if (currentPage && currentRecords.length) {
          pages.push(currentPage);
          currentPage = null;
          currentRecords = [];
        }

        const singlePage = fitPage([record], pages.length + 1);
        if (!singlePage) {
          throw new Error(`Question ${record.id || "draft"} is too long for the selected image ratio. Shorten its text; the question will not be split or cropped.`);
        }
        currentPage = singlePage;
        currentRecords = [record];
      }

      if (currentPage && currentRecords.length) pages.push(currentPage);
      if (!pages.length) throw new Error("No questions were available for rendering.");

      pages.forEach((entry, index) => {
        entry.page.textContent = `${index + 1} / ${pages.length}`;
        entry.badge.textContent = questionRange(entry.records);
        if (settings.qrUrl) {
          if (typeof QRCode === "undefined") throw new Error("QR library did not load. Reload the page and try again.");
          new QRCode(entry.qr, {
            text: settings.qrUrl,
            width: 60,
            height: 60,
            colorDark: "#0f172a",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
          });
        }
      });
      return { stage, pages };
    } catch (error) {
      stage.remove();
      throw error;
    }
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG creation failed.")), "image/png");
    });
  }

  async function renderPageBlobs(pages) {
    if (typeof html2canvas === "undefined") throw new Error("Image rendering library did not load. Reload the page and try again.");
    const results = [];
    for (const page of pages) {
      const canvas = await html2canvas(page.frame, {
        backgroundColor: null,
        scale: 1,
        useCORS: true,
        logging: false,
        width: page.width,
        height: page.height
      });
      results.push(await canvasToBlob(canvas));
    }
    return results;
  }

  async function storeImageId(settings, page, pageNumber, pageCount) {
    const payload = {
      subjectCode: settings.subjectCode,
      topicCode: settings.topicCode,
      subjectName: settings.subjectName,
      topicName: settings.topicName,
      ratio: settings.ratio,
      background: settings.background,
      borderRadius: settings.borderRadius,
      heading: settings.heading,
      pageNumber,
      pageCount,
      width: page.width,
      height: page.height,
      questionRange: questionRange(page.records),
      questionIds: page.records.map(record => record.id),
      qrUrl: settings.qrUrl || ""
    };
    const result = await api("/api/admin/image-generations", {
      method: "POST", body: JSON.stringify(payload)
    });
    return result.imageGeneration || result;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    state.objectUrls.push(url);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
  }

  function safeFilePart(value) {
    return String(value || "image").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "image";
  }

  function renderGeneratedCards(pages, blobs, settings) {
    state.objectUrls.forEach(url => URL.revokeObjectURL(url)); state.objectUrls = [];
    el.generated.replaceChildren();
    pages.forEach((page, index) => {
      const card = document.createElement("article"); card.className = "image-card";
      const top = document.createElement("div"); top.className = "image-card-top";
      const title = document.createElement("strong"); title.textContent = `Image ${String(index + 1).padStart(2, "0")}`;
      const meta = document.createElement("span"); meta.textContent = page.imageId || "ID saved";
      top.append(title, meta);
      const image = document.createElement("img");
      const imageUrl = URL.createObjectURL(blobs[index]); state.objectUrls.push(imageUrl);
      image.src = imageUrl; image.alt = `PrepareKora generated page ${index + 1}`;
      const actions = document.createElement("div"); actions.className = "image-card-actions";
      const download = document.createElement("button"); download.className = "button button-dark"; download.type = "button"; download.textContent = "Download PNG";
      download.addEventListener("click", () => downloadBlob(blobs[index], `${safeFilePart(settings.subjectCode)}_${safeFilePart(page.imageId)}.png`));
      actions.appendChild(download);
      card.append(top, image, actions);
      el.generated.appendChild(card);
    });
    el.generatedSummary.textContent = `${pages.length} image page(s) · ${pages.reduce((sum, page) => sum + page.records.length, 0)} questions · ${settings.ratio}`;
    el.zip.disabled = pages.length === 0;
  }

  async function generate() {
    if (state.generating) return;
    if (!state.drafts.length || state.drafts.some(item => item.errors.length)) return;
    if (!el.subject.value || !el.topic.value) return;
    if (el.qr.value.trim()) {
      try {
        const url = new URL(el.qr.value.trim());
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch { return setFeedback(el.generationFeedback, "Enter a valid http:// or https:// QR destination URL.", "error"); }
    }
    state.generating = true; updateGenerateState();
    el.generate.textContent = "Saving questions...";
    el.zip.disabled = true;
    setFeedback(el.generationFeedback, "Saving bilingual questions and generating permanent Question IDs...");
    let stage = null;
    try {
      await verifyAdmin();
      const records = [];
      for (let index = 0; index < state.drafts.length; index++) {
        const draft = state.drafts[index];
        const record = await saveQuestionDraft(draft);
        records.push(record);
        renderParsed();
        setFeedback(el.generationFeedback, `Saved ${index + 1} of ${state.drafts.length} questions...`);
      }
      const settings = getSettings();
      setFeedback(el.generationFeedback, "Measuring content and creating balanced image pages...");
      const built = await buildPages(records, settings);
      stage = built.stage;
      setFeedback(el.generationFeedback, `Rendering ${built.pages.length} image page(s)...`);
      const blobs = await renderPageBlobs(built.pages);

      setFeedback(el.generationFeedback, "Saving unique image IDs to Firebase Realtime Database...");
      for (let index = 0; index < built.pages.length; index++) {
        const saved = await storeImageId(settings, built.pages[index], index + 1, built.pages.length);
        built.pages[index].imageId = saved.imageId || saved.id;
        if (!built.pages[index].imageId) throw new Error("The server did not return an Image ID.");
      }
      state.pages = built.pages.map((page, index) => ({ ...page, blob: blobs[index] }));
      renderGeneratedCards(state.pages, blobs, settings);
      el.generated.scrollIntoView({ behavior: "smooth", block: "start" });
      setFeedback(el.generationFeedback, `Done. ${built.pages.length} unique Image ID(s) saved in Firebase. Download individual PNGs or all pages as ZIP.`, "success");
      await loadHistory();
    } catch (error) {
      setFeedback(el.generationFeedback, error.message || "Image generation failed.", "error");
    } finally {
      if (stage) stage.remove();
      state.generating = false;
      el.generate.textContent = "Generate images";
      updateGenerateState();
    }
  }

  async function downloadZip() {
    if (!state.pages.length) return;
    if (typeof JSZip === "undefined") return setFeedback(el.generationFeedback, "ZIP library did not load. Reload the page and try again.", "error");
    el.zip.disabled = true; el.zip.textContent = "Preparing ZIP...";
    try {
      const zip = new JSZip();
      const settings = getSettings();
      state.pages.forEach((page, index) => {
        zip.file(`${safeFilePart(settings.subjectCode)}_${safeFilePart(page.imageId)}.png`, page.blob);
      });
      const metadata = {
        subjectCode: settings.subjectCode,
        topicCode: settings.topicCode,
        ratio: settings.ratio,
        generatedAt: new Date().toISOString(),
        pages: state.pages.map((page, index) => ({ imageId: page.imageId, pageNumber: index + 1, questionIds: page.records.map(record => record.id) }))
      };
      zip.file("preparekora-export-details.json", JSON.stringify(metadata, null, 2));
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 5 } });
      downloadBlob(blob, `PrepareKora_${safeFilePart(settings.subjectCode)}_${safeFilePart(settings.topicCode)}.zip`);
      setFeedback(el.generationFeedback, "ZIP downloaded successfully.", "success");
    } catch (error) {
      setFeedback(el.generationFeedback, error.message || "ZIP download failed.", "error");
    } finally {
      el.zip.disabled = state.pages.length === 0;
      el.zip.textContent = "Download all as ZIP";
    }
  }

  async function loadHistory() {
    if (!el.subject.value) {
      el.history.textContent = "Select a subject to view saved image IDs.";
      return;
    }
    el.history.textContent = "Loading saved image IDs...";
    const data = await api(`/api/admin/image-generations?subjectCode=${encodeURIComponent(el.subject.value)}`);
    const records = Array.isArray(data.imageGenerations) ? data.imageGenerations : [];
    el.history.replaceChildren();
    if (!records.length) {
      el.history.textContent = "No image IDs saved for this subject yet.";
      return;
    }
    records.slice(0, 12).forEach(record => {
      const row = document.createElement("div"); row.className = "history-row";
      const id = document.createElement("code"); id.textContent = record.imageId || "—";
      const meta = document.createElement("span");
      const date = record.createdAt ? new Date(record.createdAt) : null;
      meta.textContent = `${record.topicName || record.topicCode || ""} · ${date && !Number.isNaN(date.getTime()) ? date.toLocaleString("en-IN") : ""}`;
      row.append(id, meta); el.history.appendChild(row);
    });
  }

  function initSwatches() {
    el.swatches.replaceChildren();
    BG_PRESETS.forEach(([name, color]) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "colour-swatch";
      button.style.background = color; button.title = `${name} ${color}`;
      button.setAttribute("aria-label", `${name} background`);
      button.setAttribute("aria-pressed", String(color === state.background));
      button.addEventListener("click", () => setBackground(color));
      el.swatches.appendChild(button);
    });
  }

  function setBackground(color) {
    state.background = color.toLowerCase();
    el.customBg.value = state.background;
    el.bgValue.textContent = state.background.toUpperCase();
    el.swatches.querySelectorAll("button").forEach(button => {
      button.setAttribute("aria-pressed", String(button.style.backgroundColor === color || button.title.endsWith(color)));
    });
  }

  function initializeRevealAnimations() {
    const nodes = document.querySelectorAll(".reveal-once:not(.is-visible)");
    if (!("IntersectionObserver" in window)) { nodes.forEach(node => node.classList.add("is-visible")); return; }
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add("is-visible"); obs.unobserve(entry.target); }
      });
    }, { threshold: 0.08 });
    nodes.forEach(node => observer.observe(node));
  }

  function bindEvents() {
    el.loginForm.addEventListener("submit", login);
    el.logout.addEventListener("click", logout);
    el.addSubject.addEventListener("click", () => openCatalogDialog("subject"));
    el.addTopic.addEventListener("click", () => openCatalogDialog("topic"));
    el.catalogForm.addEventListener("submit", saveCatalogItem);
    el.catalogClose.addEventListener("click", () => el.catalogDialog.close());
    el.catalogCancel.addEventListener("click", () => el.catalogDialog.close());
    el.subject.addEventListener("change", () => {
      populateTopics(el.subject.value);
      el.heading.value = "";
      updateGenerateState();
      loadHistory().catch(error => setFeedback(el.generationFeedback, error.message, "error"));
    });
    el.topic.addEventListener("change", () => {
      const topic = state.catalog.topics[el.subject.value]?.[el.topic.value];
      if (!el.heading.value) el.heading.value = topic?.name || "";
      updateGenerateState();
    });
    el.inputMode.addEventListener("change", () => { if (el.draft.value.trim()) parseAndPreview(); });
    let draftParseTimer = null;
    el.clear.addEventListener("click", () => {
      window.clearTimeout(draftParseTimer);
      el.draft.value = ""; state.drafts = []; el.parsedArea.hidden = true;
      el.parsedList.replaceChildren(); setFeedback(el.draftFeedback, "Input cleared."); updateGenerateState();
    });
    el.draft.addEventListener("input", () => {
      window.clearTimeout(draftParseTimer);
      state.drafts = [];
      updateGenerateState();
      if (!el.draft.value.trim()) {
        el.parsedArea.hidden = true;
        el.parsedList.replaceChildren();
        setFeedback(el.draftFeedback, "Paste your bilingual questions to see the live preview.");
        return;
      }
      setFeedback(el.draftFeedback, "Updating preview…");
      draftParseTimer = window.setTimeout(parseAndPreview, 450);
    });
    el.copyFormat.addEventListener("click", async () => {
      const template = "Q: Question (অসমীয়া প্ৰশ্ন)\nA) Option A (অসমীয়া)\nB) Option B (অসমীয়া)\nC) Option C (অসমীয়া)\nD) Option D (অসমীয়া)\nAns: C\nExplanation: Optional explanation (ঐচ্ছিক ব্যাখ্যা)\n---\nQ: Next question...";
      try { await navigator.clipboard.writeText(template); setFeedback(el.draftFeedback, "Input format copied.", "success"); }
      catch { setFeedback(el.draftFeedback, "Clipboard access unavailable. Select and copy the format shown above.", "error"); }
    });
    el.radius.addEventListener("input", () => { el.radiusValue.textContent = `${el.radius.value} px`; });
    el.customBg.addEventListener("input", () => setBackground(el.customBg.value));
    el.generate.addEventListener("click", generate);
    el.zip.addEventListener("click", downloadZip);
    el.refreshHistory.addEventListener("click", () => loadHistory().catch(error => { el.history.textContent = error.message; }));
  }

  async function bootstrap() {
    bindEvents(); initSwatches(); setBackground("#fafbfc");
    el.radiusValue.textContent = `${el.radius.value} px`;
    initializeRevealAnimations();
    try {
      const user = await verifyAdmin();
      showWorkspace(user);
    } catch {
      el.loginView.hidden = false;
      el.appView.hidden = true;
    }
  }

  bootstrap();
})();
