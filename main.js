"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => AtlasNow
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var VIEW_TYPE = "atlas-now-view";
var DEFAULTS = {
  tasksFile: "Home/Tasks.md",
  questionsFile: "Home/Questions for Boss.md",
  outboxFolder: "Home/Outbox",
  journalFolder: "Journal",
  dailyTemplate: "Home/Templates/Daily note.md",
  ignoreFolders: "Reference/, Private/, Home/Now.md",
  workoutData: ".obsidian/plugins/workout-ledger/data.json"
};
function ownerOf(s) {
  if (/(^|\s)#ai\b/i.test(s)) return "ai";
  if (/(^|\s)#together\b/i.test(s)) return "together";
  if (/(^|\s)#me\b/i.test(s)) return "me";
  return "none";
}
function stripTags(s) {
  return s.replace(/(^|\s)#(me|ai|together)\b/gi, "").replace(/📅\s*\d{4}-\d{2}-\d{2}/, "").trim();
}
function vaultPath(value, fallback) {
  const text = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return (0, import_obsidian.normalizePath)(text.replace(/\\/g, "/"));
}
// Keep line numbers while excluding YAML, fenced examples and HTML comments.
function noteContent(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let yamlEnd = -1;
  let frontmatter = {};
  if (lines[0] === "---") {
    yamlEnd = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (yamlEnd > 0) {
      try { frontmatter = import_obsidian.parseYaml(lines.slice(1, yamlEnd).join("\n")) || {}; } catch (_) {}
    }
  }
  let fence = null;
  let comment = false;
  const body = lines.map((line, i) => {
    if (i <= yamlEnd) return "";
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return "";
    }
    if (fence) return "";
    let clean = "";
    for (let j = 0; j < line.length;) {
      if (comment) {
        const end = line.indexOf("-->", j);
        if (end < 0) break;
        comment = false; j = end + 3;
      } else {
        const start = line.indexOf("<!--", j);
        if (start < 0) { clean += line.slice(j); break; }
        clean += line.slice(j, start); comment = true; j = start + 4;
      }
    }
    return clean;
  });
  return { lines, body, frontmatter };
}
var AtlasNow = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULTS;
    this.refreshTimer = null;
  }
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    for (const key of Object.keys(DEFAULTS)) {
      if (typeof this.settings[key] !== "string") this.settings[key] = DEFAULTS[key];
    }
    this.registerView(VIEW_TYPE, (leaf) => new AtlasView(leaf, this));
    this.addRibbonIcon("compass", "Atlas Now", () => this.activateView());
    this.addCommand({ id: "open", name: "Open Atlas Now", callback: () => this.activateView() });
    this.addCommand({ id: "add-task", name: "Add a task", callback: () => this.activateView(true) });
    this.addCommand({ id: "open-today", name: "Open today's daily note", callback: () => this.openToday() });
    this.addCommand({ id: "sync-workouts", name: "Sync workouts into daily notes", callback: () => this.syncWorkouts() });
    this.addCommand({ id: "refresh", name: "Refresh Atlas Now", callback: () => this.activateView() });
    this.addSettingTab(new AtlasSettingTab(this.app, this));
    const bump = () => this.scheduleRefresh();
    this.registerEvent(this.app.vault.on("modify", bump));
    this.registerEvent(this.app.vault.on("create", bump));
    this.registerEvent(this.app.vault.on("delete", bump));
    this.registerEvent(this.app.vault.on("rename", bump));
    this.registerEvent(this.app.metadataCache.on("changed", bump));
    this.registerEvent(this.app.metadataCache.on("resolved", bump));
    this.app.workspace.onLayoutReady(() => {
      this.scheduleRefresh();
      this.syncWorkouts(true).catch(() => {
      });
    });
  }
  onunload() {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.scheduleRefresh();
  }
  scheduleRefresh() {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => l.view.refresh());
    }, 600);
  }
  async activateView(focusAdd = false) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = import_obsidian.Platform.isMobile ? this.app.workspace.getLeaf(true) : this.app.workspace.getRightLeaf(false);
      if (!leaf) leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    const v = leaf.view;
    await v.refresh();
    if (focusAdd) v.focusAdd();
  }
  ignored(path) {
    return this.settings.ignoreFolders.split(",").map((s) => s.trim().replace(/\\/g, "/")).filter(Boolean).some((p) => path.startsWith(p));
  }
  // ---------- data
  async scanNotes() {
    const notes = [];
    const errors = [];
    const files = this.app.vault.getMarkdownFiles().filter((f) => !this.ignored(f.path));
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
      while (next < files.length) {
        const file = files[next++];
        try { notes.push({ file, ...noteContent(await this.app.vault.cachedRead(file)) }); }
        catch (_) { errors.push(file.path); }
      }
    }));
    return { notes, errors, total: files.length };
  }
  async collectTasks(scan = null) {
    const { notes } = scan || await this.scanNotes();
    const out = [];
    for (const { file, lines, body } of notes) {
      const project = file.path.startsWith("Projects/") ? file.path.split("/")[1] : file.parent?.name || "";
      for (let ln = 0; ln < body.length; ln++) {
        const raw = lines[ln];
        const m = body[ln].match(/^\s*(?:[-*+]|\d+[.)])\s+\[([ /])\]\s+(.*)$/);
        if (!m) continue;
        const owner = ownerOf(m[2]);
        const due = m[2].match(/📅\s*(\d{4}-\d{2}-\d{2})/)?.[1];
        out.push({ file, line: ln, raw, text: stripTags(m[2]), owner, done: false, claimed: m[1] === "/", due, project });
      }
    }
    out.sort((a, b) => {
      var _a2, _b2;
      return ((_a2 = a.due) != null ? _a2 : "9999").localeCompare((_b2 = b.due) != null ? _b2 : "9999") || a.project.localeCompare(b.project);
    });
    return out;
  }
  async collectQuestions() {
    let path = vaultPath(this.settings.questionsFile, DEFAULTS.questionsFile);
    if (!/\.md$/i.test(path)) path += ".md";
    const f = this.app.vault.getAbstractFileByPath(path);
    this.questionsStatus = { path, missing: !(f instanceof import_obsidian.TFile) };
    if (this.questionsStatus.missing) return [];
    const { lines, body } = noteContent(await this.app.vault.cachedRead(f));
    const out = [];
    let inOpen = false;
    for (let i = 0; i < lines.length; i++) {
      const l = body[i];
      if (/^\s{0,3}#{1,6}\s+(?:Open|Pending|Unanswered)\b/i.test(l)) {
        inOpen = true;
        continue;
      }
      if (/^\s{0,3}#{1,6}\s/.test(l)) {
        inOpen = false;
        continue;
      }
      if (!inOpen) continue;
      const m = l.match(/^(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.+)$/);
      if (m) {
        let answer;
        let j = i + 1;
        while (j < lines.length && (!body[j].trim() || /^\s+\S/.test(body[j]))) {
          const am = body[j].match(/^\s+[-*+]\s+(?:\*\*)?(?:Boss|Human)(?:\s*\([^)]*\))?:?(?:\*\*)?:?\s*(.*)$/i);
          if (am) answer = am[1];
          j++;
        }
        out.push({ file: f, line: i, raw: lines[i], text: m[2].replace(/\*\*/g, ""), answered: /x/i.test(m[1] || "") || !!answer?.trim(), answer });
      }
    }
    return out;
  }
  collectOutbox() {
    const folder = (0, import_obsidian.normalizePath)(this.settings.outboxFolder.trim() || DEFAULTS.outboxFolder).replace(/\/$/, "");
    const prefix = folder + "/";
    return this.app.vault.getMarkdownFiles().filter((file) => {
      if (!file.path.startsWith(prefix)) return false;
      const relative = file.path.slice(prefix.length);
      return relative !== "Outbox.md" && !relative.split("/").slice(0, -1).includes("done");
    }).map((file) => {
      var _a, _b, _c;
      const fm = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter;
      return { file, project: String((_b = fm == null ? void 0 : fm.project) != null ? _b : "No project"), status: String((_c = fm == null ? void 0 : fm.status) != null ? _c : "No status") };
    }).sort((a, b) => a.file.path.localeCompare(b.file.path));
  }
  async copyPrompt(file) {
    try {
      const raw = await this.app.vault.read(file);
      const body = raw.replace(/^\uFEFF?---[^\S\r\n]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[^\S\r\n]*(?:\r?\n|$)/, "");
      await navigator.clipboard.writeText(body);
      new import_obsidian.Notice("Prompt copied");
    } catch (e) {
      new import_obsidian.Notice("Could not copy prompt. Open the file to copy it manually.");
    }
  }
  async unfinishedNotes(scan = null) {
    const { notes } = scan || await this.scanNotes();
    return notes.filter(({ body, frontmatter }) => {
      const tags = [].concat(frontmatter.tags || []).flatMap((t) => String(t).split(/[\s,]+/));
      return tags.some((t) => t.replace(/^#/, "").toLowerCase() === "unfinished") ||
        body.some((line) => /(^|\s)#unfinished(?=$|[\s.,;:!?])/i.test(line.replace(/`[^`]*`/g, "")));
    }).map((n) => n.file).sort((a, b) => b.stat.mtime - a.stat.mtime);
  }
  // ---------- writes
  async toggleTask(t) {
    await this.app.vault.process(t.file, (data) => {
      const newline = data.includes("\r\n") ? "\r\n" : "\n";
      const lines = data.split(/\r?\n/);
      if (lines[t.line] === t.raw) lines[t.line] = t.raw.replace(/\[ \]/, "[x]") + (t.raw.includes("\u2705") ? "" : " \u2705 " + (0, import_obsidian.moment)().format("YYYY-MM-DD"));
      return lines.join(newline);
    });
  }
  async addTask(text, owner, due) {
    const path = (0, import_obsidian.normalizePath)(this.settings.tasksFile);
    let f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof import_obsidian.TFile)) f = await this.app.vault.create(path, "# Tasks\n\nQuick-added tasks. Move them to the project or note they belong to when it is obvious; otherwise they live here. Owner tags: #me \xB7 #ai \xB7 #together.\n\n");
    const line = `- [ ] ${text.trim()}${owner !== "none" ? " #" + owner : ""}${due ? " \u{1F4C5} " + due : ""} \u2795 ${(0, import_obsidian.moment)().format("YYYY-MM-DD")}`;
    await this.app.vault.append(f, (await this.app.vault.read(f)).endsWith("\n") ? line + "\n" : "\n" + line + "\n");
    new import_obsidian.Notice("Added: " + text.trim());
  }
  async answerQuestion(q, answer) {
    await this.app.vault.process(q.file, (data) => {
      const newline = data.includes("\r\n") ? "\r\n" : "\n";
      const lines = data.split(/\r?\n/);
      let index = q.line;
      if (q.raw && lines[index] !== q.raw) {
        const matches = lines.map((line, i) => line === q.raw ? i : -1).filter((i) => i >= 0);
        if (matches.length !== 1) throw new Error("Question changed; refresh before answering.");
        index = matches[0];
      }
      let j = index + 1;
      while (j < lines.length && /^\s+- /.test(lines[j])) j++;
      lines.splice(j, 0, `  - **Boss (${(0, import_obsidian.moment)().format("YYYY-MM-DD")}):** ${answer.trim().replace(/\r?\n/g, newline + "    ")}`);
      return lines.join(newline);
    });
    new import_obsidian.Notice("Answer saved");
  }
  async openAt(file, line) {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const view = leaf.view instanceof import_obsidian.MarkdownView ? leaf.view : null;
    if (view) {
      view.editor.setCursor({ line, ch: 0 });
      view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
    }
  }
  // ---------- daily note
  dailyPath(d = (0, import_obsidian.moment)()) {
    return (0, import_obsidian.normalizePath)(`${this.settings.journalFolder}/${d.format("YYYY-MM-DD")}.md`);
  }
  async ensureDaily(d = (0, import_obsidian.moment)()) {
    const path = this.dailyPath(d);
    const ex = this.app.vault.getAbstractFileByPath(path);
    if (ex instanceof import_obsidian.TFile) return ex;
    const tpl = this.app.vault.getAbstractFileByPath((0, import_obsidian.normalizePath)(this.settings.dailyTemplate));
    let body = tpl instanceof import_obsidian.TFile ? await this.app.vault.read(tpl) : "# {{date}}\n\n## Atlas\n\n## Log\n\n## Journal\n";
    body = body.replace(/\{\{date:([^}]+)\}\}/g, (_, f) => d.format(f)).replace(/\{\{date\}\}/g, d.format("YYYY-MM-DD"));
    const folder = this.app.vault.getAbstractFileByPath(this.settings.journalFolder);
    if (!folder) await this.app.vault.createFolder(this.settings.journalFolder);
    return await this.app.vault.create(path, body);
  }
  async openToday() {
    const f = await this.ensureDaily();
    await this.app.workspace.getLeaf(false).openFile(f);
  }
  async syncWorkouts(quiet = false) {
    var _a, _b, _c, _d;
    const raw = await this.app.vault.adapter.read((0, import_obsidian.normalizePath)(this.settings.workoutData)).catch(() => null);
    if (!raw) {
      if (!quiet) new import_obsidian.Notice("Workout Ledger data not found");
      return;
    }
    const data = JSON.parse(raw);
    const hist = (_a = data.history) != null ? _a : [];
    let added = 0;
    for (const h of hist) {
      const d = (0, import_obsidian.moment)(h.date);
      const f = await this.ensureDaily(d);
      const mins = Math.round(((_b = h.totalDurationSeconds) != null ? _b : 0) / 60);
      const sets = ((_c = h.exercises) != null ? _c : []).reduce((n, e) => {
        var _a2, _b2;
        return n + ((_b2 = (_a2 = e.sets) == null ? void 0 : _a2.length) != null ? _b2 : 0);
      }, 0);
      const marker = `workout-ledger:${h.id}`;
      const line = `- ${d.format("HH:mm")} workout: ${h.workoutName} \u2014 ${((_d = h.exercises) != null ? _d : []).length} exercises, ${sets} sets, ${mins} min <!-- ${marker} -->`;
      await this.app.vault.process(f, (txt) => {
        if (txt.includes(marker)) return txt;
        added++;
        txt = txt.replace(/^(---[\s\S]*?\n)workout:\s*\n([\s\S]*?---)/, (_, a, b) => `${a}workout: ${h.workoutName}
${b}`);
        const idx = txt.indexOf("## Log");
        if (idx < 0) return txt + "\n## Log\n" + line + "\n";
        const next = txt.indexOf("\n## ", idx + 6);
        const end = next < 0 ? txt.length : next;
        let section2 = txt.slice(idx, end).replace(/\n- \s*$/m, "");
        section2 = section2.trimEnd() + "\n" + line + "\n";
        return txt.slice(0, idx) + section2 + txt.slice(end);
      });
    }
    if (!quiet || added) new import_obsidian.Notice(`Workouts synced: ${added} new entr${added === 1 ? "y" : "ies"}`);
  }
};
var AtlasView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.tab = "me";
    this.addOwner = "me";
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Atlas Now";
  }
  getIcon() {
    return "compass";
  }
  async onOpen() {
    await this.refresh();
  }
  focusAdd() {
    var _a;
    (_a = this.addInput) == null ? void 0 : _a.focus();
  }
  async refresh() {
    if (this.sendingAnswer) return;
    const previousAnswer = this.answerInput;
    const previousQuestion = this.answerQuestionKey;
    let draft = previousAnswer ? previousAnswer.value : "";
    const restoreFocus = this.focusNextAnswer || (previousAnswer && previousAnswer.ownerDocument.activeElement === previousAnswer);
    const refreshId = this.refreshId = (this.refreshId || 0) + 1;
    const root = this.contentEl;
    const scan = await this.plugin.scanNotes();
    const tasks = await this.plugin.collectTasks(scan);
    let questions = [];
    let questionError = false;
    try { questions = await this.plugin.collectQuestions(); }
    catch (_) { questionError = true; }
    const unfinished = await this.plugin.unfinishedNotes(scan);
    if (refreshId !== this.refreshId || this.sendingAnswer) return;
    draft = previousAnswer ? previousAnswer.value : "";
    root.empty();
    root.addClass("atlas-now");
    this.answerInput = null;
    this.answerQuestionKey = null;
    const outbox = this.plugin.collectOutbox();
    const head = root.createDiv({ cls: "an-head" });
    head.createEl("div", { cls: "an-date", text: (0, import_obsidian.moment)().format("dddd, MMM D") });
    const refreshButton = head.createEl("button", { text: "Refresh", cls: "an-btn" });
    refreshButton.onclick = () => this.refresh();
    const btn = head.createEl("button", { text: "Today's note", cls: "an-btn" });
    btn.onclick = () => this.plugin.openToday();
    root.createDiv({ cls: "an-empty", text: `${this.plugin.app.vault.getName()} · ${scan.notes.length} notes scanned · ${tasks.length} checkbox tasks · ${unfinished.length} unfinished notes` });
    if (scan.errors.length) root.createDiv({ cls: "an-empty", text: `${scan.errors.length} notes could not be read. Wait for sync, then Refresh.` });
    const add = root.createDiv({ cls: "an-add" });
    this.addInput = add.createEl("input", { type: "text", placeholder: "Add a task\u2026 (Enter)" });
    const seg = add.createDiv({ cls: "an-seg" });
    ["me", "ai", "together"].forEach((o) => {
      const b = seg.createEl("button", { text: o === "me" ? "Me" : o === "ai" ? "AI" : "Together", cls: "an-seg-btn" + (this.addOwner === o ? " on" : "") });
      b.onclick = () => {
        this.addOwner = o;
        seg.querySelectorAll("button").forEach((x) => x.removeClass("on"));
        b.addClass("on");
        this.addInput.focus();
      };
    });
    this.addInput.onkeydown = async (e) => {
      if (e.key === "Enter" && this.addInput.value.trim()) {
        const v = this.addInput.value;
        this.addInput.value = "";
        await this.plugin.addTask(v, this.addOwner);
      }
    };
    const openQ = questions.filter((q) => !q.answered);
    const qs = section(root, "Questions for Boss", openQ.length, "", false);
    if (questionError) qs.createDiv({ cls: "an-empty", text: "Could not read questions. Wait for sync, check the Questions for Boss file setting, then Refresh." });
    else if (this.plugin.questionsStatus?.missing) qs.createDiv({ cls: "an-empty", text: `File not found: ${this.plugin.questionsStatus.path}. Sync this file or correct its path in Atlas Now settings.` });
    else if (!openQ.length) qs.createDiv({ cls: "an-empty", text: `No pending questions in ${this.plugin.questionsStatus?.path || "the configured file"}. Questions belong under an Open heading.` });
    if (openQ.length) {
      const q = openQ[0];
      this.answerQuestionKey = `${q.file.path}:${q.text}`;
      const row = qs.createDiv({ cls: "an-q" });
      row.createDiv({ cls: "an-q-text", text: q.text });
      const ans = row.createEl("textarea", { placeholder: "Answer\u2026" });
      this.answerInput = ans;
      if (!this.focusNextAnswer && previousQuestion === this.answerQuestionKey) ans.value = draft;
      ans.rows = 1;
      const b = row.createEl("button", { cls: "an-btn small", text: "Send" });
      const submit = async () => {
        if (this.sendingAnswer || !ans.value.trim()) return;
        this.sendingAnswer = true;
        ans.disabled = b.disabled = true;
        try {
          await this.plugin.answerQuestion(q, ans.value);
          this.focusNextAnswer = true;
        } catch (error) {
          new import_obsidian.Notice("Could not save answer. Your draft is still here; try again.");
          ans.disabled = b.disabled = false;
          ans.focus();
          return;
        } finally {
          this.sendingAnswer = false;
        }
        await this.refresh();
      };
      ans.onkeydown = async (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          await submit();
        }
      };
      b.onclick = submit;
      if (restoreFocus) ans.focus();
    }
    this.focusNextAnswer = false;
    const os = section(root, "Outbox", outbox.length, "", !outbox.length);
    outbox.forEach((prompt) => {
      const row = os.createDiv({ cls: "an-outbox" });
      const open = row.createEl("button", { cls: "an-prompt-title", text: prompt.file.basename });
      open.onclick = () => this.app.workspace.getLeaf(false).openFile(prompt.file);
      const meta = row.createDiv({ cls: "an-prompt-meta" });
      meta.createSpan({ text: prompt.project });
      meta.createSpan({ cls: "an-prompt-status", text: prompt.status });
      const copy = row.createEl("button", { cls: "an-btn small", text: "Copy prompt" });
      copy.onclick = () => this.plugin.copyPrompt(prompt.file);
    });
    const counts = { me: 0, together: 0, ai: 0, none: 0 };
    tasks.forEach((t) => counts[t.owner]++);
    const ts = section(root, "Tasks", tasks.length);
    const tabs = ts.createDiv({ cls: "an-tabs" });
    const defs = [["me", `Me ${counts.me}`], ["together", `Together ${counts.together}`], ["ai", `AI ${counts.ai}`], ["none", `Unassigned ${counts.none}`], ["all", `All ${tasks.length}`]];
    defs.forEach(([k, label]) => {
      const b = tabs.createEl("button", { text: label, cls: "an-tab" + (this.tab === k ? " on" : "") });
      b.onclick = () => {
        this.tab = k;
        this.refresh();
      };
    });
    const list = ts.createDiv({ cls: "an-list" });
    const shown = tasks.filter((t) => this.tab === "all" || t.owner === this.tab);
    if (!shown.length) list.createDiv({ cls: "an-empty", text: "Nothing here." });
    let lastProj = "";
    shown.forEach((t) => {
      if (t.project !== lastProj) {
        list.createDiv({ cls: "an-group", text: t.project });
        lastProj = t.project;
      }
      const row = list.createDiv({ cls: "an-task" });
      const cb = row.createEl("input", { type: "checkbox" });
      cb.disabled = !!t.claimed;
      if (t.claimed) cb.title = "In progress; open the note to update its status.";
      cb.onchange = async () => {
        row.addClass("done");
        await this.plugin.toggleTask(t);
      };
      const txt = row.createDiv({ cls: "an-task-text", text: t.text });
      txt.onclick = () => this.plugin.openAt(t.file, t.line);
      if (t.due) row.createDiv({ cls: "an-due" + (t.due < (0, import_obsidian.moment)().format("YYYY-MM-DD") ? " late" : ""), text: t.due });
      if (this.tab === "all" && t.owner !== "none") row.createDiv({ cls: "an-owner " + t.owner, text: t.owner });
    });
    const us = section(root, "Unfinished notes", unfinished.length);
    unfinished.slice(0, 40).forEach((f) => {
      var _a, _b;
      const row = us.createDiv({ cls: "an-note" });
      row.createSpan({ text: f.basename });
      row.createSpan({ cls: "an-path", text: (_b = (_a = f.parent) == null ? void 0 : _a.path) != null ? _b : "" });
      row.onclick = () => this.app.workspace.getLeaf(false).openFile(f);
    });
    if (unfinished.length > 40) us.createDiv({ cls: "an-empty", text: `+${unfinished.length - 40} more` });
  }
};
function section(root, title, n, note = "", compact = false) {
  const s = root.createDiv({ cls: "an-section" + (compact ? " an-compact" : "") });
  const h = s.createDiv({ cls: "an-h" });
  h.createSpan({ text: title });
  h.createSpan({ cls: "an-n", text: String(n) });
  if (note) h.createSpan({ cls: "an-note-txt", text: note });
  return s.createDiv({ cls: "an-body" });
}
var AtlasSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    new import_obsidian.Setting(containerEl).setName("Quick-add tasks file").addText((t) => t.setValue(s.tasksFile).onChange((v) => {
      s.tasksFile = v;
      save();
    }));
    new import_obsidian.Setting(containerEl).setName("Questions for Boss file").addText((t) => t.setValue(s.questionsFile).onChange((v) => {
      s.questionsFile = v;
      save();
    }));
    new import_obsidian.Setting(containerEl).setName("Outbox folder").addText((t) => t.setValue(s.outboxFolder).onChange((v) => {
      s.outboxFolder = v;
      save();
      this.plugin.scheduleRefresh();
    }));
    new import_obsidian.Setting(containerEl).setName("Journal folder").addText((t) => t.setValue(s.journalFolder).onChange((v) => {
      s.journalFolder = v;
      save();
    }));
    new import_obsidian.Setting(containerEl).setName("Daily note template").addText((t) => t.setValue(s.dailyTemplate).onChange((v) => {
      s.dailyTemplate = v;
      save();
    }));
    new import_obsidian.Setting(containerEl).setName("Ignore paths (comma-separated prefixes)").addText((t) => t.setValue(s.ignoreFolders).onChange((v) => {
      s.ignoreFolders = v;
      save();
    }));
    new import_obsidian.Setting(containerEl).setName("Workout Ledger data file").addText((t) => t.setValue(s.workoutData).onChange((v) => {
      s.workoutData = v;
      save();
    }));
  }
};
