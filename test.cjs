const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
class TFile {
  constructor(name) { this.path = name; this.basename = path.posix.basename(name, '.md'); this.parent = { name: path.posix.basename(path.posix.dirname(name)) }; this.stat = { mtime: 1 }; }
}
class Element {
  constructor(doc) { this.ownerDocument = doc; this.children = []; this.value = ''; }
  empty() { this.children = []; }
  addClass() {}
  createDiv(o) { return this.createEl('div', o); }
  createSpan(o) { return this.createEl('span', o); }
  createEl(tag, o = {}) { const e = new Element(this.ownerDocument); Object.assign(e, o); e.tag = tag; this.children.push(e); return e; }
  focus() { this.ownerDocument.activeElement = this; }
}
// Only the tags field is needed by these fixtures. Obsidian supplies parseYaml at runtime.
function parseYaml(text) {
  const inline = text.match(/^tags:\s*(.+)$/m);
  if (inline) return { tags: inline[1].replace(/[\[\]"']/g, '').split(/[, ]+/) };
  const block = text.match(/^tags:\s*\n((?:[ \t]+-.*\n?)*)/m);
  return { tags: block ? block[1].split('\n').map(s => s.replace(/^\s*-\s*/, '').trim()).filter(Boolean) : [] };
}
const obsidian = { Plugin: class {}, ItemView: class {}, PluginSettingTab: class {}, TFile, Platform: { isMobile: false }, parseYaml,
  Notice: class {}, normalizePath: s => s.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '').replace(/\/$/, ''), moment: () => ({ format: () => '2026-09-08' }) };
const context = { module: { exports: {} }, exports: {}, require: () => obsidian };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8') + '\nglobalThis.View = AtlasView;', context);
function setup(contents) {
  const files = Object.keys(contents).map(p => new TFile(p));
  const plugin = new context.module.exports.default();
  plugin.settings = { ...plugin.settings };
  plugin.app = { vault: { getName: () => 'Test vault', getMarkdownFiles: () => files,
    getAbstractFileByPath: p => files.find(f => f.path === p), cachedRead: async f => contents[f.path],
    process: async (f, fn) => { contents[f.path] = fn(contents[f.path]); } }, metadataCache: { getFileCache: () => null } };
  return { plugin, files };
}
const descendants = e => [e, ...e.children.flatMap(descendants)];
async function tests() {
  const contents = {
    'Home/Questions for Boss.md': '## Open\r\n- First?\r\n\r\n- Second?\r\n\r\n- Answered?\r\n\r\n  - **Human (2026-09-08):** Yes\r\n## Answered\r\n- Archived?\r\n',
    'Life/Topic.md': '---\ntags:\n  - unfinished\n---\n+ [ ] Untagged\n1. [ ] Owned #ai\n- [/] Claimed #me\n- [x] Finished\n```md\n- [ ] Example\n```\n<!--\n- [ ] Hidden\n-->\n',
    'Life/Inline.md': '#unfinished\n- [ ] Work #together',
    'Life/Code.md': '```\n#unfinished\n```',
    'Private/Hidden.md': '- [ ] Secret\n#unfinished',
  };
  contents['Life/Topic.md'] = contents['Life/Topic.md'].replace(/\n/g, '\r\n');
  const { plugin } = setup(contents);
  const scan = await plugin.scanNotes();
  assert.equal((await plugin.collectTasks(scan)).length, 4);
  const firstTask = (await plugin.collectTasks(scan)).find(t => t.text === 'Untagged');
  await plugin.toggleTask(firstTask);
  assert(contents['Life/Topic.md'].includes('+ [x] Untagged'));
  assert(contents['Life/Topic.md'].includes('\r\n'));
  contents['Life/Topic.md'] = contents['Life/Topic.md'].replace('+ [x] Untagged ✅ 2026-09-08', '+ [ ] Untagged');
  assert.equal((await plugin.unfinishedNotes(scan)).length, 2);
  assert.equal((await plugin.collectQuestions()).filter(q => !q.answered).length, 2);
  contents['Home/Questions for Boss.md'] = contents['Home/Questions for Boss.md'].replace(/\r\n/g, '\n');
  assert.equal((await plugin.collectQuestions()).filter(q => !q.answered).length, 2);
  contents['Home/Questions for Boss.md'] = contents['Home/Questions for Boss.md'].replace(/\n/g, '\r\n');
  plugin.settings.questionsFile = ' Home\\Questions for Boss ';
  assert.equal((await plugin.collectQuestions()).length, 3);
  const view = new context.View({}, plugin);
  view.contentEl = new Element({});
  await view.refresh();
  assert.equal(descendants(view.contentEl).filter(e => e.tag === 'textarea').length, 1);
  view.answerInput.value = 'First answer\nMore';
  await view.answerInput.onkeydown({ key: 'Enter', preventDefault() {} });
  assert.equal(view.answerQuestionKey, 'Home/Questions for Boss.md:Second?');
  assert.equal(view.answerInput.ownerDocument.activeElement, view.answerInput);
  assert(contents['Home/Questions for Boss.md'].includes('\r\n    More'));
  view.answerInput.value = 'Draft';
  await view.refresh();
  assert.equal(view.answerInput.value, 'Draft');
  const process = plugin.app.vault.process;
  plugin.app.vault.process = async () => { throw Error('offline'); };
  await descendants(view.contentEl).find(e => e.text === 'Send').onclick();
  assert.equal(view.answerInput.value, 'Draft');
  assert.equal(view.answerInput.disabled, false);
  plugin.app.vault.process = process;
  await descendants(view.contentEl).find(e => e.text === 'Send').onclick();
  assert.equal(view.answerInput, null);
  plugin.settings.questionsFile = 'Missing.md';
  await view.refresh();
  assert(descendants(view.contentEl).some(e => e.text?.includes('File not found: Missing.md')));
  const original = plugin.app.vault.cachedRead;
  plugin.app.vault.cachedRead = async f => { if (f.path === 'Life/Code.md') throw Error('sync'); return original(f); };
  assert.equal((await plugin.scanNotes()).errors.length, 1);
  obsidian.Platform.isMobile = true;
  const leaf = { setViewState: async () => {}, view: { refresh: async () => {} } };
  plugin.app.workspace = { getLeavesOfType: () => [], getLeaf: () => leaf, getRightLeaf: () => { throw Error('desktop-only path'); }, revealLeaf: () => {} };
  await plugin.activateView();
  console.log('PASS: cache-free tasks/tags, ignored paths, Markdown exclusions, normalized question path, queue focus/drafts/errors, missing path, partial sync, mobile activation');
}
async function actualVault(root) {
  const contents = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'Private' || entry.name === 'Reference') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) contents[path.relative(root, full).replace(/\\/g, '/')] = fs.readFileSync(full, 'utf8');
    }
  }
  walk(root);
  const { plugin } = setup(contents);
  const scan = await plugin.scanNotes();
  const tasks = await plugin.collectTasks(scan);
  const questions = await plugin.collectQuestions();
  const unfinished = await plugin.unfinishedNotes(scan);
  assert(questions.filter(q => !q.answered).length >= 5);
  assert(tasks.length > 100);
  assert(unfinished.length > 0);
  console.log(JSON.stringify({ scanned: scan.notes.length, tasks: tasks.length, pendingQuestions: questions.filter(q => !q.answered).length, unfinished: unfinished.length, readErrors: scan.errors.length }));
}
tests().then(() => process.argv[2] && actualVault(path.resolve(process.argv[2]))).catch(e => { console.error(e); process.exitCode = 1; });
