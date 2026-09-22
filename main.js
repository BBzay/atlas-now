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
  planFile: "Home/Planning/today.json",
  taskIndexFile: "Home/Planning/tasks.json",
  feedbackFile: "Home/Planning/feedback.md",
  instructionsFile: "Home/Instructions from Boss.md",
  viewStateFile: "Home/Planning/view-state.json",
  activityStateFile: "Home/Planning/activity-confirmations.json",
  taskResolutionsFile: "Home/Planning/task-resolutions.json",
  outboxFolder: "Home/Outbox",
  journalFolder: "Journal",
  dailyTemplate: "Home/Templates/Daily note.md",
  ignoreFolders: "Reference/, Private/, Home/Now.md",
  workoutData: ".obsidian/plugins/workout-ledger/data.json"
};
// The day grid always uses one linear minute scale, including reserved time.
function planMinute(value) {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(value)) throw new Error("Invalid plan time");
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
function clockLabel(minute, suffix = true) {
  const hour = Math.floor(minute / 60) % 24;
  return `${hour % 12 || 12}:${String(minute % 60).padStart(2, "0")}${suffix ? hour < 12 ? " AM" : " PM" : ""}`;
}
function zonedClock(timezone, instant = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant).map(p => [p.type, p.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}
function timelineLayout(blocks) {
  const rows = blocks.map((block, i) => ({ block, key: block.id || `block-${i}`, start: planMinute(block.start), end: planMinute(block.end) })).sort((a, b) => a.start - b.start);
  let end = 0;
  for (const row of rows) {
    if (row.end <= row.start || row.start < end) throw new Error("Invalid or overlapping plan blocks");
    end = row.end;
  }
  return { start: rows[0]?.start || 0, end: rows.at(-1)?.end || 0, rows };
}
function taskBlockId(text) {
  return String(text || "").match(/(?:^|\s)\^(task-[\w-]+)(?=\s|$)/)?.[1];
}
function completedInScan(entry, scan) {
  if (!entry) return false;
  const note = scan?.notes.find(note => note.file.path === entry.source);
  if (!note) return false;
  const normalize = text => text.replace(/\[[ xX]\]/, "[ ]").replace(/\s+✅\s*\d{4}-\d{2}-\d{2}/g, "").trim();
  return note.body.some((line, i) => /^\s*(?:[-*+]|\d+[.)])\s+\[[xX]\]\s/.test(line) && (entry.identity === "explicit" ? taskBlockId(line) === entry.id : normalize(note.lines[i]) === normalize(entry.source_text || "")));
}
function sourceTask(id, index, tasks, scan, resolutions) {
  const entry = index.find(t => t.id === id);
  // The live explicit ID survives source moves, metadata suffixes and stale indexes.
  const matches = tasks.filter(t => taskBlockId(t.raw) === id ||
    (entry?.identity === "legacy" && t.file.path === entry.source && t.raw === entry.source_text));
  if (matches.length) return { id, entry, current: matches.length === 1 ? matches[0] : null, title: matches[0].text, ambiguous: matches.length > 1 };
  const checked = scan?.notes.some(note => note.body.some(line => /^\s*(?:[-*+]|\d+[.)])\s+\[[xX]\]\s/.test(line) && taskBlockId(line) === id));
  if (checked || completedInScan(entry, scan)) return null;
  const resolution = resolutions?.resolutions?.[id];
  if (resolution?.evidence_ref && ["completed", "retired", "replaced"].includes(resolution.disposition || resolution.status)) return null;
  return { id, entry, current: null, title: entry?.title || null };
}
function blockTone(block) {
  if (["work", "commitment", "personal"].includes(block.category)) return block.category;
  return block.kind === "work" ? "work" : block.kind === "break" ? "personal" : "commitment";
}
// A calendar occurrence is distinct from the project tasks it contains.
// Time passing, reading a plan and saving a message never confirm completion.
function activityKey(plan, block) {
  return JSON.stringify([plan.date, block.calendar_event_id || block.id || `${block.start}:${block.end}:${block.title}`]);
}
function tracksActivity(block) {
  // Linked tasks already have the only checkboxes needed. Routine calendar
  // reservations never become obligations simply by appearing in the plan.
  return !(block.task_ids || []).length && block.completion_policy === "activity";
}
function validActivityState(state) {
  if (!state || state.schema_version !== 1 || !state.confirmations || Array.isArray(state.confirmations) || typeof state.confirmations !== "object") throw new Error("Invalid activity confirmations");
  return state;
}
function activityConfirmed(entry, plan, block) {
  const explicit = entry?.evidence === "boss-checkbox" || (entry?.evidence === "boss-message" && typeof entry.evidence_ref === "string" && entry.evidence_ref.trim());
  return entry?.confirmed === true && explicit && entry.date === plan.date &&
    entry.title === block.title && entry.start === block.start && entry.end === block.end &&
    JSON.stringify(entry.task_ids || []) === JSON.stringify(block.task_ids || []);
}
function ownerOf(s) {
  if (/(^|\s)#ai\b/i.test(s)) return "ai";
  if (/(^|\s)#together\b/i.test(s)) return "together";
  if (/(^|\s)#me\b/i.test(s)) return "me";
  return "none";
}
function stripTags(s) {
  return s.replace(/(^|\s)#(me|ai|together)\b/gi, "").replace(/📅\s*\d{4}-\d{2}-\d{2}/, "").replace(/(?:^|\s)\^task-[\w-]+(?=\s|$)/, "").trim();
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
    this.freshTaskFiles = new Set();
  }
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    for (const key of Object.keys(DEFAULTS)) {
      if (typeof this.settings[key] !== "string") this.settings[key] = DEFAULTS[key];
    }
    this.registerView(VIEW_TYPE, (leaf) => new AtlasView(leaf, this));
    this.addRibbonIcon("compass", "Atlas Now", () => this.activateView());
    this.addCommand({ id: "open", name: "Open Atlas Now", callback: () => this.activateView() });
    this.addCommand({ id: "add-task", name: "Write an instruction", callback: () => this.activateView(true) });
    this.addCommand({ id: "open-today", name: "Open today's daily note", callback: () => this.openToday() });
    this.addCommand({ id: "sync-workouts", name: "Sync workouts into daily notes", callback: () => this.syncWorkouts() });
    this.addCommand({ id: "refresh", name: "Refresh Atlas Now", callback: () => this.activateView() });
    this.addSettingTab(new AtlasSettingTab(this.app, this));
    this.registerInterval(window.setInterval(() => {
      this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => leaf.view.updateTimelineClock?.());
    }, 30000));
    const bump = (file, oldPath) => {
      if (file?.path && !this.relevantChange(file.path) && !(typeof oldPath === "string" && this.relevantChange(oldPath))) return;
      if (file?.path) this.freshTaskFiles.add(file.path);
      this.scheduleRefresh();
    };
    this.registerEvent(this.app.vault.on("modify", bump));
    this.registerEvent(this.app.vault.on("create", bump));
    this.registerEvent(this.app.vault.on("delete", bump));
    this.registerEvent(this.app.vault.on("rename", bump));
    // Vault events already cover content edits. Metadata resolution can fire for
    // thousands of unrelated files and must not continually replace controls.
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
      this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => l.view.refresh({ background: true }));
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
    const normalized = path.replace(/\\/g, "/");
    // Evidence, backups and source packages are not live task queues. Never let
    // a copied checkbox disable or resurrect its canonical source task.
    if (/^(?:Home\/(?:Agents|Automation)\/|Home\/Records\/Atlas review evidence\/)/i.test(normalized)) return true;
    if (normalized.split("/").some(p => p.startsWith(".") || /^(?:Private|Reference|node_modules|__pycache__|dist|build|atlas-now-plugin)$/i.test(p))) return true;
    return this.settings.ignoreFolders.split(",").map((s) => s.trim().replace(/\\/g, "/")).filter(Boolean).some((p) => normalized.startsWith(p));
  }
  relevantChange(path) {
    if (/\.md$/i.test(path)) return !this.ignored(path);
    return [this.settings.planFile, this.settings.taskIndexFile, this.settings.viewStateFile,
      this.settings.activityStateFile, this.settings.taskResolutionsFile].includes(path) ||
      /^Home\/Planning\/history\/.*\.json$/i.test(path);
  }
  // ---------- data
  async readJson(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) return null;
    if (path === this.settings.activityStateFile) return JSON.parse(await this.app.vault.read(file));
    return JSON.parse(await this.app.vault.cachedRead(file));
  }
  async collectPlan() {
    const plan = await this.readJson(this.settings.planFile);
    if (!plan) return null;
    if (plan.schema_version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(plan.date) || !Array.isArray(plan.blocks)) throw new Error("Invalid plan");
    for (const b of plan.blocks) {
      if (typeof b.title !== "string" || !Array.isArray(b.task_ids) || !/^\d{2}:\d{2}$/.test(b.start) || !/^\d{2}:\d{2}$/.test(b.end)) throw new Error("Invalid block");
    }
    if (Number.isNaN(new Date(plan.date + "T12:00:00Z").getTime())) throw new Error("Invalid plan date");
    zonedClock(plan.timezone);
    timelineLayout(plan.blocks);
    if (plan.blocks.some(b => b.details != null && (!Array.isArray(b.details) || b.details.some(d => typeof d !== "string")))) throw new Error("Invalid block details");
    const index = await this.readJson(this.settings.taskIndexFile);
    return { plan, index: index?.tasks || [] };
  }
  async collectActivityHistory(current) {
    const days = new Map();
    const references = new Map();
    const remember = plan => {
      const refs = references.get(plan.date) || new Map();
      for (const id of plan.unscheduled_task_ids || []) if (!refs.has(id)) refs.set(id, null);
      for (const block of plan.blocks) for (const id of block.task_ids || []) refs.set(id, block.title);
      references.set(plan.date, refs);
    };
    const files = this.app.vault.getFiles?.() || [];
    for (const file of files.filter(f => /^Home\/Planning\/history\/\d{4}-\d{2}-\d{2}-r\d+\.json$/.test(f.path))) {
      const plan = JSON.parse(await this.app.vault.cachedRead(file));
      if (!Array.isArray(plan.blocks) || !/^\d{4}-\d{2}-\d{2}$/.test(plan.date)) throw new Error("Invalid activity history");
      remember(plan);
      if (!days.has(plan.date) || plan.revision > days.get(plan.date).revision) days.set(plan.date, plan);
    }
    if (current) { remember(current); days.set(current.date, current); }
    return [...days.values()].map(plan => ({ ...plan, historical_task_titles: Object.fromEntries(references.get(plan.date) || []) })).sort((a, b) => b.date.localeCompare(a.date));
  }
  async setActivityConfirmation(plan, block, confirmed, expected) {
    if (!tracksActivity(block)) throw new Error("Use the source task checkbox; routine activities do not need completion tracking.");
    const path = this.settings.activityStateFile;
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      try { file = await this.app.vault.create(path, JSON.stringify({ schema_version: 1, confirmations: {} }, null, 2) + "\n"); }
      catch (error) { file = this.app.vault.getAbstractFileByPath(path); if (!file) throw error; }
    }
    const key = activityKey(plan, block);
    await this.app.vault.process(file, data => {
      const state = validActivityState(JSON.parse(data));
      if (JSON.stringify(state.confirmations[key] || null) !== JSON.stringify(expected || null)) throw new Error("Activity changed; refresh before confirming it.");
      const previous = state.confirmations[key];
      state.confirmations[key] = { confirmed, evidence: "boss-checkbox", recorded_at: new Date().toISOString(),
        date: plan.date, block_id: block.id || null, calendar_event_id: block.calendar_event_id || null,
        title: block.title, start: block.start, end: block.end, task_ids: block.task_ids || [],
        history: previous ? [...(previous.history || []), { confirmed: previous.confirmed, recorded_at: previous.recorded_at, evidence: previous.evidence }] : [] };
      return JSON.stringify(state, null, 2) + "\n";
    });
  }
  async saveCorrection(text) {
    if (!text.trim()) return;
    const path = this.settings.feedbackFile;
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) throw new Error("Planning feedback file is missing; run vault setup first.");
    const id = "feedback-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await this.app.vault.process(file, (data) => data + `\n- **Boss (${(0, import_obsidian.moment)().format("YYYY-MM-DD")}):** ${text.trim().replace(/\r?\n/g, "\n  ")} ^${id}\n  - Status: pending agent review; preserve this request until applied.\n`);
    // The saved correction remains durable even if creating the queue task fails.
    try { await this.addTask(`Apply schedule correction [[${path.replace(/\.md$/, "")}#^${id}]]`, "ai"); }
    catch (_) { new import_obsidian.Notice("Correction saved in planning feedback; task creation failed. The next pass reads feedback."); }
  }
  async saveInstruction(text) {
    if (!text.trim()) return;
    const file = this.app.vault.getAbstractFileByPath(this.settings.instructionsFile);
    if (!file) throw new Error("Instructions file is missing; run vault setup first.");
    const id = "task-instruction-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const quoted = text.trim().replace(/\r?\n/g, "\n> ");
    const entry = `\n### Instruction ${new Date().toISOString()}\n\n> ${quoted}\n\n- [ ] Handle Boss instruction above #ai ^${id}\n\nStatus: pending.\nPriority: high (new Tell Atlas input).\n`;
    await this.app.vault.process(file, data => data + entry);
    return id;
  }
  async acknowledgeUpdate(update) {
    const path = this.settings.viewStateFile;
    const file = this.app.vault.getAbstractFileByPath(path);
    const apply = data => {
      const state = data ? JSON.parse(data) : { schema_version: 1, seen_updates: {} };
      state.seen_updates = state.seen_updates || {};
      state.seen_updates[update.id] = { text: update.text, seen_at: new Date().toISOString() };
      return JSON.stringify(state, null, 2) + "\n";
    };
    if (file) await this.app.vault.process(file, apply);
    else await this.app.vault.create(path, apply(null));
  }
  async scanNotes() {
    const notes = [];
    const errors = [];
    const files = this.app.vault.getMarkdownFiles().filter((f) => !this.ignored(f.path));
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
      while (next < files.length) {
        const file = files[next++];
        try { notes.push({ file, ...noteContent(await (this.freshTaskFiles.has(file.path) ? this.app.vault.read(file) : this.app.vault.cachedRead(file))) }); }
        catch (_) { errors.push(file.path); }
      }
    }));
    notes.sort((a, b) => a.file.path.localeCompare(b.file.path));
    errors.sort();
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
    let openLevel = 2;
    for (let i = 0; i < lines.length; i++) {
      const l = body[i];
      if (/^\s{0,3}#{1,6}\s+(?:Open|Pending|Unanswered)\b/i.test(l)) {
        inOpen = true;
        openLevel = l.trimStart().match(/^#+/)[0].length;
        continue;
      }
      if (/^\s{0,3}#{1,6}\s/.test(l)) {
        if (l.trimStart().match(/^#+/)[0].length <= openLevel) inOpen = false;
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
    for (const q of out) {
      const field = name => q.text.match(new RegExp("\\[" + name + "::\\s*([^\\]]+)\\]", "i"))?.[1]?.trim();
      const target = q.text.match(/\[\[([^\]|#]+)/)?.[1] || "";
      q.project = field("project") || (target.startsWith("Projects/") ? target.split("/")[1] : target.startsWith("Business/BizCollab/") ? "TELI" : target.startsWith("Life/") ? target.split("/")[1] : "General");
      const priority = (field("priority") || "").toLowerCase();
      // Explicit priorities win over incidental wording. Tell Atlas and current
      // planning markers retain their standing high-priority promotion.
      const promoted = /\[source::\s*tell-atlas\]/i.test(q.text) || /\[planning::\s*true\]/i.test(q.text);
      const assigned = /^(high|p1|urgent)$/.test(priority) ? 0 : /^(normal|p2)$/.test(priority) ? 1 : /^(low|p3|p4)$/.test(priority) ? 2 : null;
      q.priority = promoted ? 0 : assigned ?? (/\b(today|tomorrow|this week|next week|next few days|high priority)\b/i.test(q.text) ? 0 : 1);
      q.displayText = q.text.replace(/\s*\[(?:project|priority|source|planning)::[^\]]*\]/gi, "");
    }
    return out.sort((a, b) => a.priority - b.priority || a.project.localeCompare(b.project) || a.line - b.line);
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
      let index = t.line;
      const id = taskBlockId(t.raw);
      if (id) {
        const body = noteContent(data).body;
        const matches = body.map((line, i) => /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX/]\]\s/.test(line) && taskBlockId(line) === id ? i : -1).filter(i => i >= 0);
        if (matches.length !== 1) throw new Error("Task changed; refresh before completing it.");
        index = matches[0];
      } else if (lines[index] !== t.raw) {
        const matches = lines.map((line, i) => line === t.raw ? i : -1).filter(i => i >= 0);
        if (matches.length !== 1) throw new Error("Task changed; refresh before completing it.");
        index = matches[0];
      }
      if (/^\s*(?:[-*+]|\d+[.)])\s+\[[xX]\]\s/.test(lines[index])) return data;
      if (!/^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s/.test(lines[index])) throw new Error("Task is in progress; open its note to review the claim.");
      const block = id ? "^" + id : null;
      const base = lines[index].replace(/(?:^|\s)\^task-[\w-]+(?=\s|$)/, "").replace(/\[ \]/, "[x]");
      lines[index] = base + (base.includes("\u2705") ? "" : " \u2705 " + (0, import_obsidian.moment)().format("YYYY-MM-DD")) + (block ? " " + block : "");
      return lines.join(newline);
    });
    this.freshTaskFiles.add(t.file.path);
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
    this.closed = false;
    await this.refresh();
  }
  async onClose() {
    this.closed = true;
    this.refreshId = (this.refreshId || 0) + 1;
    clearTimeout(this.deferredTimer);
    this.releasePointer?.();
    this.interactionGuard = false;
  }
  installInteractionGuard() {
    if (this.interactionGuard || !this.contentEl.addEventListener) return;
    this.interactionGuard = true;
    const root = this.contentEl;
    const press = () => { this.pointerHeld = true; };
    root.addEventListener("pointerdown", press, true);
    const release = () => {
      this.pointerHeld = false;
      if (this.refreshDeferred) this.deferRefresh();
    };
    root.ownerDocument.addEventListener("pointerup", release, true);
    root.ownerDocument.addEventListener("pointercancel", release, true);
    const focusout = () => { if (this.refreshDeferred) this.deferRefresh(); };
    root.addEventListener("focusout", focusout);
    root.ownerDocument.defaultView?.addEventListener("blur", release);
    this.releasePointer = () => {
      root.removeEventListener("pointerdown", press, true);
      root.removeEventListener("focusout", focusout);
      root.ownerDocument.removeEventListener("pointerup", release, true);
      root.ownerDocument.removeEventListener("pointercancel", release, true);
      root.ownerDocument.defaultView?.removeEventListener("blur", release);
    };
  }
  interacting() {
    const active = this.contentEl.ownerDocument.activeElement;
    return this.pointerHeld || (!!this.contentEl.contains?.(active) && !!active?.matches?.("textarea,select,input:not([type=checkbox]),[contenteditable=true]"));
  }
  deferRefresh() {
    this.refreshDeferred = true;
    clearTimeout(this.deferredTimer);
    this.deferredTimer = setTimeout(() => {
      if (!this.closed && !this.interacting()) this.refresh({ background: true });
    }, 150);
  }
  focusAdd() {
    var _a;
    (_a = this.addInput) == null ? void 0 : _a.focus();
  }
  async completeTask(task, checkbox) {
    if (!task || checkbox.disabled) return;
    if (this.contentEl.ownerDocument.activeElement === checkbox) {
      const controls = [...(this.contentEl.querySelectorAll?.("button,input,textarea,select,summary") || [])].filter(e => !e.disabled && e.getClientRects().length);
      this.pendingFocus = { index: controls.indexOf(checkbox), key: checkbox.getAttribute?.("aria-label") };
    }
    this.pendingTaskWrites = (this.pendingTaskWrites || 0) + 1;
    checkbox.disabled = true;
    try { await this.plugin.toggleTask(task); }
    catch (error) { checkbox.checked = false; new import_obsidian.Notice("Could not complete task: " + error.message); }
    finally {
      checkbox.disabled = false;
      this.pendingTaskWrites--;
      if (!this.pendingTaskWrites) await this.refresh();
    }
  }
  renderSourceTasks(parent, ids, index, tasks, scan, fallbackTitle = null) {
    for (const id of ids) {
      const ref = sourceTask(id, index, tasks, scan, this.taskResolutions);
      if (!ref) continue;
      const { current } = ref;
      const title = ref.title || fallbackTitle || "Earlier action needs source review";
      const row = parent.createDiv({ cls: "an-task" });
      const target = row.createEl("label", { cls: "an-task-check", attr: { "aria-label": `Complete: ${title}` } });
      const cb = target.createEl("input", { attr: { type: "checkbox", "aria-label": title } });
      cb.disabled = !current || current.claimed;
      cb.title = current?.claimed ? "In progress" : current ? "Complete source task" : "Atlas needs to reconcile this action's source";
      const label = row.createEl(current ? "button" : "span", { cls: "an-task-text an-text-button", text: title, ...(current ? { attr: { type: "button", "aria-label": `Open task: ${title}` } } : {}) });
      if (current) label.onclick = () => this.plugin.openAt(current.file, current.line);
      else row.createSpan({ cls: "an-source-note", text: "Source needs review" });
      if (current?.claimed) row.createSpan({ cls: "an-source-note", text: "In progress" });
      cb.onchange = () => this.completeTask(current, cb);
    }
  }
  renderNextActions(parent, history, current, index, tasks, scan) {
    const clock = zonedClock(current?.timezone || "America/Chicago");
    const scheduled = new Set((current?.blocks || []).filter(b => current.date > clock.date || (current.date === clock.date && planMinute(b.end) > clock.minute)).flatMap(b => b.task_ids || []));
    const seen = new Set();
    const pending = [];
    const add = (id, title = null) => {
      if (seen.has(id)) { const prior = pending.find(p => p.id === id); if (prior && !prior.title) prior.title = title; return; }
      if (scheduled.has(id)) return;
      seen.add(id);
      const ref = sourceTask(id, index, tasks, scan, this.taskResolutions);
      const resolution = this.taskResolutions?.resolutions?.[id];
      if (!ref && resolution?.evidence_ref && (resolution.disposition || resolution.status) === "replaced") {
        for (const replacement of resolution.replacement_task_ids || (resolution.replacement_task_id ? [resolution.replacement_task_id] : [])) add(replacement);
      }
      if (ref && (ref.current?.owner || ref.entry?.owner) !== "ai") pending.push({ id, title });
    };
    for (const id of current?.unscheduled_task_ids || []) add(id);
    const oneOffs = [];
    for (const plan of history.filter(p => p.date <= clock.date)) {
      for (const [id, title] of Object.entries(plan.historical_task_titles || {})) add(id, title);
      for (const id of plan.unscheduled_task_ids || []) add(id);
      for (const block of plan.blocks) {
        for (const id of block.task_ids || []) add(id, block.title);
        if (tracksActivity(block) && (plan.date < clock.date || planMinute(block.end) <= clock.minute) && !activityConfirmed(this.activityState?.confirmations[activityKey(plan, block)], plan, block)) oneOffs.push({ plan, block });
      }
    }
    if (!pending.length && !oneOffs.length) return;
    const section = parent.createDiv({ cls: "an-untimed" });
    section.createDiv({ cls: "an-selected-title", text: `Next actions (${pending.length + oneOffs.length})` });
    for (const { id, title } of pending) this.renderSourceTasks(section, [id], index, tasks, scan, title);
    for (const { plan, block } of oneOffs) {
      const row = section.createDiv({ cls: "an-history-activity" });
      row.createDiv({ cls: "an-selected-title", text: block.title });
      row.createDiv({ cls: "an-selected-time", text: `From ${plan.date}` });
      this.renderActivityActions(row, plan, block);
    }
  }
  renderActivityActions(parent, plan, block) {
    const key = activityKey(plan, block);
    const entry = this.activityState?.confirmations[key];
    const confirmed = activityConfirmed(entry, plan, block);
    const controls = parent.createDiv({ cls: "an-activity-actions" });
    if (tracksActivity(block)) {
    const label = controls.createEl("label", { cls: "an-activity-check" });
    const cb = label.createEl("input", { attr: { type: "checkbox", "aria-label": `I completed ${block.title} on ${plan.date}` } });
    cb.checked = confirmed;
    cb.disabled = !!this.activityStateError;
    label.createSpan({ text: confirmed ? "Activity confirmed done" : "I completed this activity" });
    const status = parent.createDiv({ cls: "an-activity-status", text: confirmed ? "Confirmed by you. Linked tasks keep their own checkboxes." : "Unconfirmed. Scheduled time is not completion.", attr: { role: "status", "aria-live": "polite" } });
    cb.onchange = async () => {
      if (this.pendingTaskWrites) return;
      this.pendingTaskWrites = (this.pendingTaskWrites || 0) + 1;
      cb.disabled = true;
      try { await this.plugin.setActivityConfirmation(plan, block, cb.checked, entry); }
      catch (error) { cb.checked = confirmed; new import_obsidian.Notice("Could not save activity: " + error.message); }
      finally { this.pendingTaskWrites--; await this.refresh(); }
    };
    }
    const talk = controls.createEl("button", { text: "Discuss with Atlas", cls: "an-btn", attr: { "aria-expanded": "false" } });
    const editor = parent.createDiv({ cls: "an-activity-discussion" });
    this.activityDrafts ||= new Map();
    this.activityEditors ||= new Set();
    editor.hidden = !this.activityEditors.has(key);
    talk.setAttribute("aria-expanded", String(!editor.hidden));
    const inputLabel = editor.createEl("label", { text: `About ${block.title}` });
    const input = inputLabel.createEl("textarea", { attr: { placeholder: "Tell Atlas what happened or what needs to change…" } });
    input.value = this.activityDrafts.get(key) || "";
    input.rows = 3;
    input.oninput = () => this.activityDrafts.set(key, input.value);
    const save = editor.createEl("button", { text: "Save message", cls: "an-btn" });
    const response = editor.createDiv({ cls: "an-source-note", attr: { role: "status", "aria-live": "polite" } });
    talk.onclick = () => {
      editor.hidden = !editor.hidden;
      if (editor.hidden) this.activityEditors.delete(key); else { this.activityEditors.add(key); input.focus(); }
      talk.setAttribute("aria-expanded", String(!editor.hidden));
    };
    save.onclick = async () => {
      if (!input.value.trim() || this.sendingInstruction) return;
      this.sendingInstruction = true; save.disabled = input.disabled = true;
      try {
        await this.plugin.saveInstruction(`About scheduled activity: ${block.title}\nDate: ${plan.date}, ${block.start}–${block.end} (${plan.timezone || "America/Chicago"})\nActivity key: ${key}\nSource tasks: ${(block.task_ids || []).join(", ") || "none"}\n\n${input.value.trim()}`);
        this.activityDrafts.delete(key); input.value = "";
        response.textContent = "Saved for the next AI session. Completion is unchanged.";
      } catch (_) { response.textContent = "Could not save. Your message is still here."; }
      finally { this.sendingInstruction = false; save.disabled = input.disabled = false; }
    };
  }
  renderActivityReview(parent, history, current, index, tasks, scan) {
    const clock = zonedClock(current?.timezone || "America/Chicago");
    const rows = history.flatMap(plan => plan.blocks.map(block => ({ plan, block }))).filter(({ plan }) => plan.date <= clock.date);
    const isConfirmed = ({ plan, block }) => activityConfirmed(this.activityState?.confirmations[activityKey(plan, block)], plan, block);
    const reserved = rows.filter(row => row.plan.date === current?.date && (row.block.display === "hidden" || (row.block.kind === "break" && planMinute(row.block.end) - planMinute(row.block.start) <= 20)));
    const confirmed = rows.filter(row => tracksActivity(row.block) && isConfirmed(row));
    for (const [name, items] of [["Reserved time", reserved], ["Confirmed one-off actions", confirmed]]) {
      if (!items.length) continue;
      const section = parent.createEl("details", { cls: "an-activity-review" });
      this.activitySections ||= new Set(); section.open = this.activitySections.has(name);
      section.ontoggle = () => section.open ? this.activitySections.add(name) : this.activitySections.delete(name);
      section.createEl("summary", { text: `${name} (${items.length})` });
      // Render on expansion so a long history does not slow down the day view.
      let rendered = false;
      const render = () => {
        if (rendered) return; rendered = true;
        for (const { plan, block } of items) {
          const row = section.createDiv({ cls: "an-history-activity" });
          row.createDiv({ cls: "an-selected-title", text: block.title });
          row.createDiv({ cls: "an-selected-time", text: `${plan.date} · ${block.start}–${block.end}` });
          this.renderActivityActions(row, plan, block);
          this.renderSourceTasks(row, block.task_ids || [], index, tasks, scan);
        }
      };
      const toggle = section.ontoggle;
      section.ontoggle = () => { toggle(); if (section.open) render(); };
      if (section.open) render();
    }
  }
  updateTimelineClock(instant = new Date()) {
    const state = this.timelineState;
    if (!state) return;
    const clock = zonedClock(state.plan.timezone, instant);
    const inDay = clock.date === state.plan.date;
    const visible = inDay && clock.minute >= state.layout.start && clock.minute < state.layout.end;
    state.marker.hidden = !visible;
    state.marker.setAttribute("style", `top:${(clock.minute - state.layout.start) * state.scale}px`);
    state.markerLabel.textContent = clockLabel(clock.minute, false);
    for (const row of state.events) {
      const current = inDay && clock.minute >= row.start && clock.minute < row.end;
      row.element.setAttribute("data-current", String(current));
      row.element.setAttribute("aria-current", current ? "time" : "false");
    }
    state.dateWarning.hidden = inDay;
    state.dateWarning.textContent = `Showing ${state.plan.date}; today's plan has not been refreshed.`;
  }
  renderTimeline(parent, plan, index, tasks, scan) {
    const layout = timelineLayout(plan.blocks);
    if (!layout.rows.length) {
      parent.createDiv({ cls: "an-empty", text: "No activities scheduled yet." });
      return;
    }
    const scale = this.timelineExpanded ? 1.2 : 0.72;
    const clock = zonedClock(plan.timezone);
    const visible = layout.rows.filter(row => row.block.display !== "hidden" && !(row.block.kind === "break" && row.end - row.start <= 20));
    const toolbar = parent.createDiv({ cls: "an-timeline-toolbar" });
    toolbar.createSpan({ text: "Day timeline" });
    const zoom = toolbar.createEl("button", { cls: "an-btn", text: this.timelineExpanded ? "Fit day" : "Expand", attr: { "aria-label": this.timelineExpanded ? "Use compact day scale" : "Expand the time scale" } });
    zoom.onclick = async () => { this.timelineExpanded = !this.timelineExpanded; await this.refresh(); };
    const legend = parent.createDiv({ cls: "an-timeline-legend" });
    for (const [tone, label] of [["work", "Work"], ["commitment", "Commitments"], ["personal", "Personal"], ["reserved", "Reserved"]]) legend.createSpan({ cls: `an-key an-key-${tone}`, text: label });
    const warning = parent.createDiv({ cls: "an-warning" });
    const grid = parent.createDiv({ cls: "an-timeline", attr: { style: `height:${(layout.end - layout.start) * scale}px`, "aria-label": `Day timeline for ${plan.date}` } });
    const hourMarks = new Set([layout.start, layout.end]);
    for (let minute = Math.ceil(layout.start / 60) * 60; minute < layout.end; minute += 60) hourMarks.add(minute);
    for (const minute of [...hourMarks].sort((a, b) => a - b)) {
      const hour = grid.createDiv({ cls: "an-hour", attr: { style: `top:${(minute - layout.start) * scale}px`, "aria-hidden": "true" } });
      hour.createSpan({ text: `${Math.floor(minute / 60) % 12 || 12}${minute % 60 ? ":" + String(minute % 60).padStart(2, "0") : ""}${minute % 1440 < 720 ? "a" : "p"}` });
    }
    for (let minute = Math.ceil(layout.start / 30) * 30; minute < layout.end; minute += 30) {
      if (minute % 60 && !hourMarks.has(minute)) grid.createDiv({ cls: "an-half-hour", attr: { style: `top:${(minute - layout.start) * scale}px`, "aria-hidden": "true" } });
    }
    const events = [];
    for (const row of layout.rows) {
      const { block, start, end } = row;
      const height = (end - start) * scale;
      if (!visible.includes(row)) {
        grid.createDiv({ cls: "an-reserved-time", attr: { style: `top:${(start - layout.start) * scale}px;height:${height}px`, "aria-hidden": "true" } });
        continue;
      }
      const element = grid.createEl("button", { cls: `an-time-event an-time-${blockTone(block)}${height < 24 ? " an-event-tiny" : height < 58 ? " an-event-short" : ""}`, attr: {
        style: `top:${(start - layout.start) * scale}px;height:${height}px`,
        "aria-label": `${block.title}, ${clockLabel(start)} to ${clockLabel(end)}. Show details.`, "aria-pressed": "false",
        title: `${clockLabel(start)}–${clockLabel(end)} · ${block.title}`
      } });
      if (height >= 24) element.createSpan({ cls: "an-event-title", text: block.title });
      if (height >= 44) element.createSpan({ cls: "an-event-time", text: `${clockLabel(start)}–${clockLabel(end)}` });
      if (height >= 95 && block.details?.length) element.createSpan({ cls: "an-event-place", text: block.details[0] });
      events.push({ ...row, element });
    }
    const marker = grid.createDiv({ cls: "an-now-line", attr: { "aria-hidden": "true" } });
    const markerLabel = marker.createSpan();
    this.timelineState = { plan, layout, scale, marker, markerLabel, events, dateWarning: warning };
    this.updateTimelineClock();
    const detail = parent.createDiv({ cls: "an-activity-detail" });
    if (visible.length) {
      const body = detail.createDiv({ cls: "an-activity-body" });
      const select = key => {
        const row = visible.find(row => row.key === key) || visible[0];
        this.selectedActivity = `${plan.date}:${row.key}`;
        for (const event of events) event.element.setAttribute("aria-pressed", String(event.key === row.key));
        body.empty();
        body.createDiv({ cls: "an-selected-title", text: row.block.title });
        body.createDiv({ cls: "an-selected-time", text: `${clockLabel(row.start)}–${clockLabel(row.end)} · ${row.end - row.start} min` });
        for (const text of row.block.details || []) body.createDiv({ cls: "an-block-detail", text });
        this.renderActivityActions(body, plan, row.block);
        this.renderSourceTasks(body, row.block.task_ids, index, tasks, scan);
      };
      for (const row of events) row.element.onclick = () => { select(row.key); detail.scrollIntoView?.({ block: "nearest", behavior: "auto" }); };
      const remembered = visible.find(row => this.selectedActivity === `${plan.date}:${row.key}`);
      const active = clock.date === plan.date && visible.find(row => row.start <= clock.minute && row.end > clock.minute);
      const next = clock.date === plan.date && visible.find(row => row.start > clock.minute);
      select((remembered || active || next || visible[0]).key);
    } else detail.createDiv({ cls: "an-empty", text: "No activities scheduled yet." });
  }
  rememberQuestionDraft() {
    this.questionDrafts ||= new Map();
    if (this.answerQuestionKey && this.answerInput) this.questionDrafts.set(this.answerQuestionKey, this.answerInput.value);
  }
  renderQuestions(qs, questions, focusControl = null, restoreFocus = false) {
    this.rememberQuestionDraft();
    // Remove focus from the old textarea before rebuilding only this section.
    if (focusControl) this.answerInput?.blur?.();
    this.answerInput = null;
    this.answerQuestionKey = null;
    qs.empty();
    const openQ = questions.filter(q => !q.answered);
    const keyOf = q => `${q.file.path}:${q.text}`;
    let visibleQ = openQ.slice();
    const projects = [...new Set(openQ.map(q => q.project))];
    if (this.questionProject && !projects.includes(this.questionProject)) this.questionProject = "";
    if (openQ.length) {
      const controls = qs.createDiv({ cls: "an-question-controls" });
      const label = controls.createEl("label", { text: "Project" });
      const select = label.createEl("select", { attr: { "aria-label": "Question project" } });
      select.createEl("option", { text: "All projects", attr: { value: "" } });
      for (const project of projects) {
        const count = openQ.filter(q => q.project === project).length;
        select.createEl("option", { text: `${project} (${count})`, attr: { value: project } });
      }
      select.value = this.questionProject || "";
      select.onchange = () => {
        if (this.sendingAnswer) return;
        this.questionProject = select.value;
        this.selectedQuestion = null;
        this.renderQuestions(qs, questions, "project");
      };
      if (focusControl === "project") select.focus({ preventScroll: true });
      if (this.questionProject) visibleQ = visibleQ.filter(q => q.project === this.questionProject);
      qs.createDiv({ cls: "an-source-note", text: `${visibleQ.length} available · ${openQ.length} unanswered · High → normal → low priority` });
      if (!visibleQ.length) qs.createDiv({ cls: "an-empty", text: "No questions in this selection. Choose another project." });
    }
    if (visibleQ.length) {
      const q = visibleQ.find(q => keyOf(q) === this.selectedQuestion) || visibleQ[0];
      this.selectedQuestion = keyOf(q);
      const position = visibleQ.indexOf(q);
      qs.createDiv({ cls: "an-question-position", text: `${q.project} · ${["High priority", "Normal priority", "Low priority"][q.priority]} · ${position + 1} of ${visibleQ.length}`, attr: { role: "status", "aria-live": "polite" } });
      const navigation = qs.createDiv({ cls: "an-question-controls an-question-navigation", attr: { role: "group", "aria-label": "Question navigation" } });
      const navigate = (text, action, disabled = false) => {
        const button = navigation.createEl("button", { cls: "an-btn", text, attr: { type: "button" } });
        button.disabled = disabled;
        button.onclick = () => {
          if (this.sendingAnswer || button.disabled) return;
          action();
          // Browsing never rescans the vault or summons the phone keyboard.
          this.renderQuestions(qs, questions, text);
        };
        if (focusControl === text && !disabled) button.focus({ preventScroll: true });
      };
      navigate("Previous", () => { this.selectedQuestion = keyOf(visibleQ[position - 1]); }, position === 0);
      navigate("Next", () => { this.selectedQuestion = keyOf(visibleQ[position + 1]); }, position === visibleQ.length - 1);
      this.answerQuestionKey = `${q.file.path}:${q.text}`;
      const row = qs.createDiv({ cls: "an-q" });
      row.createDiv({ cls: "an-q-text", text: q.displayText });
      const ans = row.createEl("textarea", { attr: { placeholder: "Answer\u2026", "aria-label": "Answer question" } });
      this.answerInput = ans;
      ans.value = this.questionDrafts.get(this.answerQuestionKey) || "";
      ans.rows = 1;
      row.createDiv({ cls: "an-source-note", text: "Enter to save · Shift+Enter for a new line" });
      const submit = async () => {
        if (this.sendingAnswer || !ans.value.trim()) return;
        this.sendingAnswer = true;
        ans.disabled = true;
        try {
          await this.plugin.answerQuestion(q, ans.value);
          this.questionDrafts.delete(this.answerQuestionKey);
          ans.value = "";
          this.selectedQuestion = null;
          this.focusNextAnswer = true;
        } catch (error) {
          new import_obsidian.Notice("Could not save answer. Your draft is still here; try again.");
          ans.disabled = false;
          ans.focus();
          return;
        } finally {
          this.sendingAnswer = false;
        }
        await this.refresh();
      };
      ans.onkeydown = async (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !e.repeat) {
          e.preventDefault();
          await submit();
        }
      };
      if (restoreFocus) ans.focus({ preventScroll: true });
    }
  }
  async refresh(options = {}) {
    if (this.closed) return;
    this.installInteractionGuard();
    if (this.refreshRunning) {
      this.refreshQueued = true;
      this.forceQueued = this.forceQueued || !options.background;
      return this.refreshRunning;
    }
    this.refreshRunning = this.renderRefresh(options);
    try { await this.refreshRunning; }
    catch (error) { new import_obsidian.Notice("Could not refresh Atlas. Your current view is still available. " + error.message); }
    finally { this.refreshRunning = null; }
    if (this.refreshQueued && !this.closed) {
      const background = !this.forceQueued;
      this.refreshQueued = this.forceQueued = false;
      await this.refresh({ background });
    }
  }
  async renderRefresh({ background = false } = {}) {
    if (background && this.interacting()) { this.deferRefresh(); return; }
    if (this.pendingTaskWrites || this.sendingAnswer || this.sendingInstruction || this.savingSeen) { this.deferRefresh(); return; }
    const previousInstruction = this.addInput;
    const instructionFocused = previousInstruction && previousInstruction.ownerDocument.activeElement === previousInstruction;
    this.rememberQuestionDraft();
    const refreshId = this.refreshId = (this.refreshId || 0) + 1;
    const root = this.contentEl;
    const scan = await this.plugin.scanNotes();
    const tasks = await this.plugin.collectTasks(scan);
    let questions = [];
    let questionError = false;
    try { questions = await this.plugin.collectQuestions(); }
    catch (_) { questionError = true; }
    const unfinished = await this.plugin.unfinishedNotes(scan);
    let daily = null;
    let planError = false;
    try { daily = await this.plugin.collectPlan(); } catch (_) { planError = true; }
    let activityHistory = [];
    let activityHistoryError = false;
    try { activityHistory = await this.plugin.collectActivityHistory(daily?.plan); } catch (_) { activityHistoryError = true; }
    let activityState = null;
    let activityStateError = false;
    try { activityState = validActivityState(await this.plugin.readJson(this.plugin.settings.activityStateFile) || { schema_version: 1, confirmations: {} }); } catch (_) { activityStateError = true; }
    let taskResolutions = null;
    try { taskResolutions = await this.plugin.readJson(this.plugin.settings.taskResolutionsFile); } catch (_) { activityHistoryError = true; }
    let viewState = null;
    let viewStateError = false;
    try { viewState = await this.plugin.readJson(this.plugin.settings.viewStateFile); } catch (_) { viewStateError = true; }
    if (this.closed || refreshId !== this.refreshId || this.pendingTaskWrites || this.sendingAnswer || this.sendingInstruction || this.savingSeen) return;
    if (background && this.interacting()) { this.deferRefresh(); return; }
    this.refreshDeferred = false;
    const outbox = this.plugin.collectOutbox();
    const signature = JSON.stringify({ tasks: tasks.map(t => [t.file.path, t.line, t.raw]), questions: questions.map(q => [q.file.path, q.raw, q.answered, q.answer]), questionError,
      questionStatus: this.plugin.questionsStatus, unfinished: unfinished.map(f => f.path), daily, planError,
      activityHistory, activityHistoryError, activityState, activityStateError, taskResolutions, viewState, viewStateError,
      outbox: outbox.map(p => [p.file.path, p.project, p.status]), notes: scan.notes.length, errors: scan.errors,
      completed: scan.notes.flatMap(n => n.body.filter(line => /^\s*(?:[-*+]|\d+[.)])\s+\[[xX]\]\s/.test(line)).map(line => [n.file.path, line])) });
    if (background && signature === this.renderSignature) { this.updateTimelineClock(); return; }
    this.rememberQuestionDraft();
    const restoreFocus = this.focusNextAnswer || (this.answerInput && this.answerInput.ownerDocument.activeElement === this.answerInput);
    const scrollTop = root.scrollTop;
    const controls = () => [...(root.querySelectorAll?.("button,input,textarea,select,summary") || [])].filter(e => !e.disabled && e.getClientRects().length);
    const controlKey = e => e?.getAttribute?.("aria-label") || e?.textContent || e?.tagName;
    const active = root.ownerDocument.activeElement;
    const oldControls = controls();
    const activeIndex = oldControls.indexOf(active) >= 0 ? oldControls.indexOf(active) : this.pendingFocus?.index ?? -1;
    const activeKey = oldControls.includes(active) ? controlKey(active) : this.pendingFocus?.key;
    this.pendingFocus = null;
    const selection = active?.tagName === "TEXTAREA" ? [active.selectionStart, active.selectionEnd] : null;
    root.empty();
    root.addClass("atlas-now");
    this.activityState = activityState;
    this.activityStateError = activityStateError;
    this.taskResolutions = taskResolutions;
    this.answerInput = null;
    this.answerQuestionKey = null;
    const head = root.createDiv({ cls: "an-head" });
    const dateLabel = head.createDiv({ cls: "an-date" });
    const displayDate = daily ? new Date(daily.plan.date + "T12:00:00Z") : new Date();
    const dateZone = daily ? "UTC" : "America/Chicago";
    dateLabel.createDiv({ cls: "an-weekday", text: new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: dateZone }).format(displayDate) });
    dateLabel.createDiv({ cls: "an-date-sub", text: new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: dateZone }).format(displayDate) });
    const refreshButton = head.createEl("button", { text: "↻", cls: "an-btn an-icon-btn", attr: { "aria-label": "Refresh Atlas Now", title: "Refresh" } });
    refreshButton.onclick = () => this.refresh();
    const btn = head.createEl("button", { text: "↗", cls: "an-btn an-icon-btn", attr: { "aria-label": "Open today's note", title: "Today's note" } });
    btn.onclick = () => this.plugin.openToday();
    const update = daily?.plan.session_update;
    if (update?.id && typeof update.text === "string" && update.text.trim() && viewState?.seen_updates?.[update.id]?.text !== update.text) {
      const notice = root.createDiv({ cls: "an-session-update" });
      notice.createDiv({ text: update.text });
      const label = notice.createEl("label", { cls: "an-seen" });
      const seen = label.createEl("input", { attr: { type: "checkbox", "aria-label": "Mark session update as seen" } });
      label.createSpan({ text: "Seen" });
      seen.onchange = async () => {
        if (!seen.checked || this.savingSeen) return;
        this.savingSeen = true; seen.disabled = true;
        try { await this.plugin.acknowledgeUpdate(update); }
        catch (_) { seen.checked = false; new import_obsidian.Notice("Could not save Seen. The update will stay visible."); }
        finally { this.savingSeen = false; seen.disabled = false; }
        await this.refresh();
      };
    }
    const openQ = questions.filter((q) => !q.answered);
    const qs = section(root, "Questions for Boss", openQ.length, "", !openQ.length && !questionError && !this.plugin.questionsStatus?.missing);
    if (questionError) qs.createDiv({ cls: "an-empty", text: "Could not read questions. Wait for sync, check the Questions for Boss file setting, then Refresh." });
    else if (this.plugin.questionsStatus?.missing) qs.createDiv({ cls: "an-empty", text: `File not found: ${this.plugin.questionsStatus.path}. Sync this file or correct its path in Atlas Now settings.` });
    else if (!openQ.length) qs.createDiv({ cls: "an-empty", text: "No questions right now." });
    if (openQ.length) this.renderQuestions(qs.createDiv({ cls: "an-questions-body" }), questions, null, restoreFocus);
    this.focusNextAnswer = false;
    const instruction = root.createDiv({ cls: "an-instruction" });
    const instructionLabel = instruction.createEl("label", { text: "Tell Atlas" });
    this.addInput = instructionLabel.createEl("textarea", { attr: { placeholder: "Add something, change my day, or tell Atlas what to do…" } });
    this.addInput.value = previousInstruction ? previousInstruction.value : this.instructionDraft || "";
    this.addInput.rows = 3;
    this.addInput.oninput = () => { this.instructionDraft = this.addInput.value; };
    const instructionStatus = instruction.createDiv({ cls: "an-source-note", attr: { role: "status", "aria-live": "polite" } });
    instruction.createDiv({ cls: "an-source-note", text: "Enter to save · Shift+Enter for a new line" });
    const submitInstruction = async () => {
      const input = this.addInput;
      if (!input.value.trim() || this.sendingInstruction) return;
      this.sendingInstruction = true; input.disabled = true;
      try {
        await this.plugin.saveInstruction(input.value);
        this.instructionDraft = ""; input.value = "";
        instructionStatus.textContent = "Saved for the next AI session.";
      } catch (_) { instructionStatus.textContent = "Could not save. Your instruction is still here."; }
      finally { this.sendingInstruction = false; input.disabled = false; input.focus({ preventScroll: true }); }
    };
    this.addInput.onkeydown = async e => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !e.repeat) { e.preventDefault(); await submitInstruction(); }
    };
    if (instructionFocused) this.addInput.focus();
    this.timelineState = null;
    const today = root.createDiv({ cls: "an-today" });
    if (planError) today.createDiv({ cls: "an-warning", text: "The saved plan could not be read. Refresh after sync or ask an agent to validate it." });
    else if (!daily) today.createDiv({ cls: "an-empty", text: "No day plan yet. Your next plan will appear here." });
    else this.renderTimeline(today, daily.plan, daily.index, tasks, scan);
    if (activityStateError) today.createDiv({ cls: "an-warning", text: "Activity confirmations could not be read. No completion assumed; retry after sync." });
    if (activityHistoryError) today.createDiv({ cls: "an-warning", text: "Earlier activities could not be read. Their completion is unknown." });
    this.renderNextActions(today, activityHistory, daily?.plan, daily?.index || [], tasks, scan);
    this.renderActivityReview(today, activityHistory, daily?.plan, daily?.index || [], tasks, scan);
    const counts = { me: 0, together: 0, ai: 0, none: 0 };
    tasks.forEach((t) => counts[t.owner]++);
    const backlog = root.createEl("details", { cls: "an-backlog" });
    backlog.open = this.backlogOpen || false;
    backlog.ontoggle = () => { this.backlogOpen = backlog.open; };
    backlog.createEl("summary", { text: `All tasks and unfinished notes (${tasks.length})` });
    const ts = section(backlog, "Tasks", tasks.length);
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
      const target = row.createEl("label", { cls: "an-task-check", attr: { "aria-label": `Complete: ${t.text}` } });
      const cb = target.createEl("input", { attr: { type: "checkbox", "aria-label": t.text } });
      cb.disabled = !!t.claimed;
      if (t.claimed) cb.title = "In progress; open the note to update its status.";
      cb.onchange = () => this.completeTask(t, cb);
      const txt = row.createEl("button", { cls: "an-task-text an-text-button", text: t.text, attr: { type: "button", "aria-label": `Open task: ${t.text}` } });
      txt.onclick = () => this.plugin.openAt(t.file, t.line);
      if (t.due) row.createDiv({ cls: "an-due" + (t.due < (0, import_obsidian.moment)().format("YYYY-MM-DD") ? " late" : ""), text: t.due });
      if (this.tab === "all" && t.owner !== "none") row.createDiv({ cls: "an-owner " + t.owner, text: t.owner });
    });
    const us = section(backlog, "Unfinished notes", unfinished.length);
    unfinished.slice(0, 40).forEach((f) => {
      var _a, _b;
      const row = us.createEl("button", { cls: "an-note an-text-button", attr: { type: "button", "aria-label": `Open unfinished note: ${f.basename}` } });
      row.createSpan({ text: f.basename });
      row.createSpan({ cls: "an-path", text: (_b = (_a = f.parent) == null ? void 0 : _a.path) != null ? _b : "" });
      row.onclick = () => this.app.workspace.getLeaf(false).openFile(f);
    });
    if (unfinished.length > 40) us.createDiv({ cls: "an-empty", text: `+${unfinished.length - 40} more` });
    const system = root.createEl("details", { cls: "an-system" });
    system.open = this.systemOpen || false;
    system.ontoggle = () => { this.systemOpen = system.open; };
    system.createEl("summary", { text: "System details" });
    if (daily) {
      system.createDiv({ cls: "an-source-note", text: `Plan ${daily.plan.date} · ${daily.plan.status} · revision ${daily.plan.revision || "?"}` });
      if (daily.plan.summary) system.createDiv({ cls: "an-source-note", text: daily.plan.summary });
      for (const [source, state] of Object.entries(daily.plan.source_status || {})) system.createDiv({ cls: "an-source-note", text: `${source}: ${state}` });
    }
    if (viewStateError) system.createDiv({ cls: "an-warning", text: "Seen state could not be read; updates remain visible." });
    system.createDiv({ cls: "an-source-note", text: `${this.plugin.app.vault.getName()} · ${scan.notes.length} notes · ${tasks.length} tasks · ${unfinished.length} unfinished` });
    if (scan.errors.length) system.createDiv({ cls: "an-source-note", text: `${scan.errors.length} notes could not be read.` });
    system.createDiv({ cls: "an-source-note", text: "Instructions save to the vault. Automatic agent wakeup is not connected." });
    const os = section(system, "Outbox", outbox.length, "", !outbox.length);
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
    if (!restoreFocus && typeof scrollTop === "number") root.scrollTop = scrollTop;
    if (!this.focusNextAnswer && !restoreFocus && activeIndex >= 0) {
      const nextControls = controls();
      const next = nextControls.find(e => controlKey(e) === activeKey) || nextControls[Math.min(activeIndex, nextControls.length - 1)];
      next?.focus({ preventScroll: true });
      if (selection && next?.tagName === "TEXTAREA") next.setSelectionRange(...selection);
    }
    this.renderSignature = signature;
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
    new import_obsidian.Setting(containerEl).setName("Agent tasks file").addText((t) => t.setValue(s.tasksFile).onChange((v) => {
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
