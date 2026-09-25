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
  setAttribute(key, value) { this[key] = String(value); }
  createDiv(o) { return this.createEl('div', o); }
  createSpan(o) { return this.createEl('span', o); }
  createEl(tag, o = {}) { const e = new Element(this.ownerDocument); for (const key of Object.keys(o)) assert(['cls', 'text', 'attr', 'title', 'parent', 'prepend'].includes(key), 'Unsupported Obsidian createEl option: ' + key); for (const key of ['cls', 'text', 'title']) if (key in o) e[key] = o[key]; Object.assign(e, o.attr || {}); e.tag = tag; this.children.push(e); return e; }
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
const context = { module: { exports: {} }, exports: {}, require: () => obsidian, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8') + '\nglobalThis.View = AtlasView; globalThis.timelineLayout = timelineLayout; globalThis.zonedClock = zonedClock;', context);
function setup(contents) {
  const files = Object.keys(contents).map(p => new TFile(p));
  const plugin = new context.module.exports.default();
  plugin.settings = { ...plugin.settings };
  plugin.app = { vault: { getName: () => 'Test vault', getMarkdownFiles: () => files,
    getAbstractFileByPath: p => files.find(f => f.path === p), cachedRead: async f => contents[f.path], read: async f => contents[f.path],
    process: async (f, fn) => { contents[f.path] = fn(contents[f.path]); } }, metadataCache: { getFileCache: () => null } };
  return { plugin, files };
}
const descendants = e => [e, ...e.children.flatMap(descendants)];
async function tests() {
  {
  // Backups once appeared as live duplicates, disabling canonical checkboxes.
  const reliabilityContents = {
    'Life/Real.md': '- [ ] Real action #me ^task-real\n',
    'Home/Agents/session/before/Home/Tasks.md': '- [ ] Real action #me ^task-real\n- [ ] Snapshot ghost #me ^task-ghost\n',
    'Home/Automation/backups/Tasks.md': '- [x] Real action #me ^task-real\n',
    'Projects/Atlas/atlas-now-plugin/README.md': '- [ ] Example #me ^task-example\n',
    'Home/Records/Canvas/Coursework tasks.md': '- [ ] Coursework #me ^task-course\n',
    'Home/Planning/today.json': JSON.stringify({ schema_version: 1, date: '2026-09-08', blocks: [], unscheduled_task_ids: ['task-real'] }),
    'Home/Planning/tasks.json': JSON.stringify({tasks:[{id:'task-real',identity:'explicit',source:'Life/Real.md',title:'Real action'}]})
  };
  const reliability = setup(reliabilityContents).plugin;
  const rv = new context.View({}, reliability); rv.contentEl = new Element({});
  await rv.refresh();
  const live = descendants(rv.contentEl).find(e => e.title === 'Complete source task');
  assert(live && !live.disabled, 'Snapshot copies must not disable the real task');
  assert.equal((await reliability.collectTasks()).length, 2);
  assert(!reliability.relevantChange('Home/Agents/session/before/Home/Tasks.md'));
  assert(!reliability.relevantChange('image.png'));
  assert(reliability.relevantChange('Home/Planning/today.json'));
  assert(reliability.relevantChange('Life/Real.md'));
  const stableInput = rv.addInput;
  await rv.refresh({background:true});
  assert.equal(rv.addInput, stableInput, 'Unchanged background data must not replace the DOM');
  const realScan = reliability.scanNotes.bind(reliability);
  let release, scans = 0;
  reliability.scanNotes = () => { scans++; return new Promise(resolve => { release = resolve; }); };
  const slow = rv.refresh({background:true});
  rv.pointerHeld = true;
  release(await realScan()); await slow;
  assert.equal(rv.addInput, stableInput, 'A pointer pressed during a scan must retain its target');
  assert(rv.refreshDeferred);
  rv.pointerHeld = false; reliability.scanNotes = realScan;
  await rv.refresh({background:true});
  // Coalesce event bursts into one running scan and one catch-up, never overlaps.
  let activeScans = 0, maxScans = 0;
  reliability.scanNotes = async () => { activeScans++; maxScans=Math.max(maxScans,activeScans); await new Promise(r=>setTimeout(r,5)); const result=await realScan(); activeScans--; return result; };
  await Promise.all([rv.refresh({background:true}),rv.refresh({background:true}),rv.refresh({background:true})]);
  assert.equal(maxScans,1);
  reliability.scanNotes = realScan;
  const captured = (await reliability.collectTasks()).find(t=>t.raw.includes('^task-real'));
  reliabilityContents['Life/Real.md'] = '# New heading\n- [ ] Real action #me ^task-real 📅 2026-09-23\n';
  await reliability.toggleTask(captured);
  assert(reliabilityContents['Life/Real.md'].includes('[x] Real action #me'));
  assert(reliabilityContents['Life/Real.md'].includes('📅 2026-09-23'), 'Preserve live metadata, not stale captured text');
  const saved = reliabilityContents['Life/Real.md'];
  await reliability.toggleTask(captured); assert.equal(reliabilityContents['Life/Real.md'],saved, 'Repeated completion is idempotent');
  reliabilityContents['Life/Real.md'] = '- [ ] One #me ^task-real\n- [ ] Two #me ^task-real\n';
  await assert.rejects(()=>reliability.toggleTask(captured), /Task changed/);
  reliabilityContents['Life/Real.md'] = '- [/] Claimed #me ^task-real\n';
  await assert.rejects(()=>reliability.toggleTask(captured), /in progress/);
  await rv.onClose();
  console.log('PASS: snapshot exclusion, canonical checkbox, stable background DOM, pointer race, coalesced scans, live metadata, idempotence and claim/duplicate guards');
  }
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
  assert.equal(descendants(view.contentEl).filter(e => e.tag === 'textarea').length, 2);
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
  await view.answerInput.onkeydown({key:'Enter',preventDefault(){}});
  assert.equal(view.answerInput.value, 'Draft');
  assert.equal(view.answerInput.disabled, false);
  plugin.app.vault.process = process;
  await view.answerInput.onkeydown({key:'Enter',preventDefault(){}});
  assert.equal(view.answerInput, null);
  plugin.settings.questionsFile = 'Missing.md';
  await view.refresh();
  assert(descendants(view.contentEl).some(e => e.text?.includes('File not found: Missing.md')));
  const grouped = setup({'Home/Questions for Boss.md': '## Open\n### Projects\n- Later? [[Projects/Zebra/Hub]] [priority:: low]\n- Plan? [[Projects/Atlas/Hub]] [planning:: true]\n- Buy? [[Projects/Zebra/Hub]] [source:: tell-atlas]\n- Normal? [[Projects/Atlas/Hub]]\n## Answered\n- Old?\n'});
  const queue = await grouped.plugin.collectQuestions();
  assert.equal(queue.length, 4);
  assert.equal(queue[0].project, 'Atlas');
  assert.equal(queue[1].priority, 0);
  assert(!queue[0].displayText.includes('[planning::'));
  const nav = new context.View({}, grouped.plugin); nav.contentEl = new Element({});
  const click = async text => { const button = descendants(nav.contentEl).find(e => e.tag === 'button' && e.text === text); assert(button && !button.disabled, text); await button.onclick(); };
  await nav.refresh();
  nav.answerInput.value = 'Keep this draft';
  await click('Next'); assert(nav.answerQuestionKey.includes('Buy?'));
  await click('Previous'); assert.equal(nav.answerInput.value, 'Keep this draft');
  assert(!descendants(nav.contentEl).some(e => ['Skip question', 'Skip project', 'Restore skipped'].includes(e.text)));
  nav.skippedQuestions = new Set(['Home/Questions for Boss.md:Plan? [[Projects/Atlas/Hub]] [planning:: true]']);
  nav.skippedProjects = new Set(['Atlas']);
  await nav.refresh(); assert(nav.answerQuestionKey.includes('Plan?'));
  await click('Next'); assert(nav.answerQuestionKey.includes('Buy?'));
  await click('Next'); assert(nav.answerQuestionKey.includes('Normal?'));
  await click('Next'); assert(nav.answerQuestionKey.includes('Later?'));
  assert(descendants(nav.contentEl).find(e => e.text === 'Next').disabled);
  assert.equal((await grouped.plugin.collectQuestions()).filter(q => q.answered).length, 0);
  await click('Previous'); await click('Previous'); await click('Previous');
  assert(nav.answerQuestionKey.includes('Plan?')); assert.equal(nav.answerInput.value, 'Keep this draft');
  assert(descendants(nav.contentEl).find(e => e.text === 'Previous').disabled);
  const select = descendants(nav.contentEl).find(e => e.tag === 'select' && e['aria-label'] === 'Question project');
  select.value = 'Zebra'; await select.onchange(); assert(nav.answerQuestionKey.includes('Buy?'));
  nav.answerInput.value = 'Yes'; await nav.answerInput.onkeydown({key:'Enter',preventDefault(){}}); assert(nav.answerQuestionKey.includes('Later?'));
  // Mobile browsing is local: even a slow/unavailable vault cannot block Next.
  obsidian.Platform.isMobile = true;
  nav.questionProject = ''; nav.selectedQuestion = null; await nav.refresh();
  const scanBeforeNavigation = grouped.plugin.scanNotes;
  grouped.plugin.scanNotes = async () => { throw Error('Navigation must not rescan'); };
  const instructionBeforeNavigation = nav.addInput;
  nav.addInput.value = 'Keep instruction draft';
  nav.answerInput.value = 'Mobile answer draft';
  nav.answerInput.focus();
  await click('Next');
  assert(nav.answerQuestionKey.includes('Normal?'));
  assert.notEqual(nav.answerInput.ownerDocument.activeElement, nav.answerInput, 'Navigation must not open the keyboard');
  assert.equal(nav.addInput, instructionBeforeNavigation, 'Browsing must not rebuild the whole panel');
  await click('Previous');
  assert.equal(nav.answerInput.value, 'Mobile answer draft');
  assert.equal(nav.addInput.value, 'Keep instruction draft');
  grouped.plugin.scanNotes = scanBeforeNavigation;
  // A background refresh may finish after navigation and more typing.
  let releaseScan;
  grouped.plugin.scanNotes = () => new Promise(resolve => { releaseScan = resolve; });
  const background = nav.refresh();
  await click('Next'); nav.answerInput.value = 'Typed while refresh was pending';
  releaseScan(await scanBeforeNavigation.call(grouped.plugin));
  await background;
  assert(nav.answerQuestionKey.includes('Normal?'));
  assert.equal(nav.answerInput.value, 'Typed while refresh was pending');
  grouped.plugin.scanNotes = scanBeforeNavigation;
  // Explicit metadata overrides incidental words, across all projects.
  const ranking = setup({'Home/Questions for Boss.md': '## Open\n- Low asks about today [[Projects/Alpha/Hub]] [priority:: low]\n- Normal this week [[Projects/Alpha/Hub]] [priority:: normal]\n- Urgent [[Projects/Zebra/Hub]] [priority:: high]\n- Promoted [[Projects/Zebra/Hub]] [priority:: low] [planning:: true]\n- Input [[Projects/Zebra/Hub]] [priority:: low] [source:: tell-atlas]\n- Legacy tomorrow [[Projects/Zebra/Hub]]\n## Answered\n'});
  const ranked = await ranking.plugin.collectQuestions();
  assert.deepEqual(Array.from(ranked, q => q.priority), [0, 0, 0, 0, 1, 2]);
  assert(ranked[0].text.includes('Urgent'));
  nav.questionProject = 'Removed project';
  await nav.refresh();
  assert.equal(nav.questionProject, '', 'An obsolete filter must not strand the queue');
  obsidian.Platform.isMobile = false;
  const original = plugin.app.vault.cachedRead;
  plugin.app.vault.cachedRead = async f => { if (f.path === 'Life/Code.md') throw Error('sync'); return original(f); };
  assert.equal((await plugin.scanNotes()).errors.length, 1);
  obsidian.Platform.isMobile = true;
  const leaf = { setViewState: async () => {}, view: { refresh: async () => {} } };
  plugin.app.workspace = { getLeavesOfType: () => [], getLeaf: () => leaf, getRightLeaf: () => { throw Error('desktop-only path'); }, revealLeaf: () => {} };
  await plugin.activateView();
  const dailyContents = {
    'Home/Questions for Boss.md': '## Open\n## Answered\n',
    'Life/Focus.md': '- [ ] Focus work #me ^task-focus\n',
    'Home/Planning/feedback.md': '# Feedback\n',
    'Home/Planning/today.json': JSON.stringify({ schema_version: 1, date: '2026-09-08', status: 'provisional', blocks: [{ start: '08:30', end: '09:30', title: 'Deep work', task_ids: ['task-focus'] }] }),
    'Home/Planning/tasks.json': JSON.stringify({ tasks: [{ id: 'task-focus', identity: 'explicit', source: 'Life/Focus.md', title: 'Focus work' }] })
  };
  const dailyPlugin = setup(dailyContents).plugin;
  const dailyView = new context.View({}, dailyPlugin);
  dailyView.contentEl = new Element({});
  await dailyView.refresh();
  assert(descendants(dailyView.contentEl).some(e => e.text === 'Deep work'));
  const planned = descendants(dailyView.contentEl).find(e => e.title === 'Complete source task');
  assert(planned && !planned.disabled);
  assert.equal(planned.type, 'checkbox');
  assert(descendants(dailyView.contentEl).filter(e => e.tag === 'input' && e.type === 'checkbox').length >= 2);
  await planned.onchange();
  assert(dailyContents['Life/Focus.md'].includes('[x] Focus work #me ✅ 2026-09-08 ^task-focus'));
  assert(!descendants(dailyView.contentEl).some(e => e.cls === 'an-task-text' && e.text === 'Focus work'), 'Completed task must disappear even when the plan index is stale');
  dailyContents['Life/Focus.md'] = '- [ ] Focus work #me ^task-focus\n';
  const unassignedPlan = JSON.parse(dailyContents['Home/Planning/today.json']);
  unassignedPlan.blocks = [];
  unassignedPlan.unscheduled_task_ids = ['task-focus'];
  dailyContents['Home/Planning/today.json'] = JSON.stringify(unassignedPlan);
  await dailyView.refresh();
  assert(descendants(dailyView.contentEl).some(e => e.text?.startsWith('Next actions (')));
  const unassigned = descendants(dailyView.contentEl).find(e => e.title === 'Complete source task');
  await unassigned.onchange();
  assert(dailyContents['Life/Focus.md'].includes('[x] Focus work #me ✅ 2026-09-08 ^task-focus'));
  let queued = null;
  dailyPlugin.addTask = async (text, owner) => { queued = { text, owner }; };
  await dailyPlugin.saveCorrection('Only one hour today');
  assert(dailyContents['Home/Planning/feedback.md'].includes('Only one hour today'));
  assert.equal(queued.owner, 'ai');
  assert(queued.text.includes('#^feedback-'));
  dailyContents['Home/Instructions from Boss.md'] = '# Instructions\n';
  dailyContents['Home/Planning/view-state.json'] = JSON.stringify({schema_version: 1, seen_updates: {}});
  const controlPlugin = setup(dailyContents).plugin;
  const controlView = new context.View({}, controlPlugin);
  controlView.contentEl = new Element({});
  const controlPlan = JSON.parse(dailyContents['Home/Planning/today.json']);
  controlPlan.session_update = {id: 'session-a', text: 'Gym removed today.'};
  controlPlan.summary = 'Agent planning rationale';
  controlPlan.source_status = {calendar: 'Unavailable'};
  controlPlan.blocks = [{start:'09:30',end:'09:50',title:'Hidden drive',kind:'break',display:'hidden',task_ids:[]}];
  dailyContents['Home/Planning/today.json'] = JSON.stringify(controlPlan);
  await controlView.refresh();
  assert(!descendants(controlView.contentEl).some(e => ['Change my day','Add a task… (Enter)','Hidden drive'].includes(e.text)));
  const system = controlView.contentEl.children.at(-1);
  assert.equal(system.tag, 'details');
  assert(descendants(system).some(e => e.text === 'Agent planning rationale'));
  assert(descendants(controlView.contentEl).some(e => e.text === 'Gym removed today.'));
  const processControl = controlPlugin.app.vault.process;
  controlPlugin.app.vault.process = async () => { throw Error('disk failure'); };
  let seen = descendants(controlView.contentEl).find(e => e['aria-label'] === 'Mark session update as seen');
  seen.checked = true; await seen.onchange();
  assert(descendants(controlView.contentEl).some(e => e.text === 'Gym removed today.'));
  controlPlugin.app.vault.process = processControl;
  seen = descendants(controlView.contentEl).find(e => e['aria-label'] === 'Mark session update as seen');
  seen.checked = true; await seen.onchange();
  assert(!descendants(controlView.contentEl).some(e => e.text === 'Gym removed today.'));
  const reopened = new context.View({}, controlPlugin); reopened.contentEl = new Element({});
  await reopened.refresh();
  assert(!descendants(reopened.contentEl).some(e => e.text === 'Gym removed today.'));
  controlPlan.session_update = {id: 'session-b', text: 'Lunch changed.'};
  dailyContents['Home/Planning/today.json'] = JSON.stringify(controlPlan);
  await reopened.refresh(); assert(descendants(reopened.contentEl).some(e => e.text === 'Lunch changed.'));
  controlPlan.session_update.details = ['Campus parking changed.', '  ', null, '<b>plain text</b>'];
  dailyContents['Home/Planning/today.json'] = JSON.stringify(controlPlan);
  await reopened.refresh();
  assert(descendants(reopened.contentEl).some(e => e.tag === 'summary' && e.text === 'More to know (2)'));
  assert(descendants(reopened.contentEl).some(e => e.tag === 'li' && e.text === '<b>plain text</b>'));
  seen = descendants(reopened.contentEl).find(e => e['aria-label'] === 'Mark session update as seen');
  seen.checked = true; await seen.onchange();
  assert(!descendants(reopened.contentEl).some(e => e.text === 'Campus parking changed.'));
  controlPlan.session_update.details = ['Campus parking changed again.'];
  dailyContents['Home/Planning/today.json'] = JSON.stringify(controlPlan);
  await reopened.refresh();
  assert(descendants(reopened.contentEl).some(e => e.text === 'Campus parking changed again.'), 'Changed details must reappear even when headline and ID match');
  reopened.addInput.value = 'Move lunch\n- [ ] This is input, not a task #ai';
  await reopened.refresh(); assert(reopened.addInput.value.startsWith('Move lunch'));
  assert(!descendants(reopened.contentEl).some(e => ['Send','Save instruction'].includes(e.text)));
  const beforeIgnored = JSON.stringify(dailyContents);
  for (const flags of [{shiftKey:true},{isComposing:true},{repeat:true}]) {
    await reopened.addInput.onkeydown({key:'Enter',...flags,preventDefault(){throw Error('Must preserve newline/composition/repeat');}});
  }
  assert.equal(JSON.stringify(dailyContents),beforeIgnored);
  controlPlugin.app.vault.process = async () => { throw Error('offline'); };
  await reopened.addInput.onkeydown({key:'Enter',preventDefault(){}});
  assert(reopened.addInput.value.startsWith('Move lunch'));
  assert.equal(reopened.addInput.disabled, false);
  controlPlugin.app.vault.process = processControl;
  await reopened.addInput.onkeydown({key:'Enter',preventDefault(){}});
  assert.equal(reopened.addInput.value, '');
  assert(dailyContents['Home/Instructions from Boss.md'].includes('> Move lunch\n> - [ ] This is input, not a task #ai'));
  assert.equal((dailyContents['Home/Instructions from Boss.md'].match(/Handle Boss instruction above/g)||[]).length,1);
  const queuedInstructions = (await controlPlugin.collectTasks(await controlPlugin.scanNotes())).filter(t => t.file.path === 'Home/Instructions from Boss.md');
  assert.equal(queuedInstructions.length,1);
  assert.equal(queuedInstructions[0].owner,'ai');
  const layout = context.timelineLayout([
    {id:'early',start:'04:30',end:'05:00',title:'Early',task_ids:[]},
    {id:'reserved',start:'05:00',end:'05:20',title:'Travel',display:'hidden',task_ids:[]},
    {id:'late',start:'23:00',end:'24:00',title:'Late',task_ids:[]}
  ]);
  assert.equal(layout.start,270);
  assert.equal(layout.end,1440);
  assert.equal(layout.rows[1].end-layout.rows[1].start,20);
  for (const bad of ['24:01','09:60','25:00','9:30']) assert.throws(()=>context.timelineLayout([{start:bad,end:'24:00'}]));
  assert.throws(()=>context.timelineLayout([{start:'09:00',end:'08:00'}]));
  assert.throws(()=>context.timelineLayout([{start:'09:00',end:'10:00'},{start:'09:30',end:'10:30',display:'hidden'}]));
  assert.equal(context.zonedClock('America/Chicago',new Date('2026-09-10T05:01:00Z')).date,'2026-09-10');
  assert.equal(context.zonedClock('America/Chicago',new Date('2026-01-10T05:01:00Z')).date,'2026-01-09');
  assert.equal(context.zonedClock('America/Chicago',new Date('2026-09-09T17:24:00Z')).minute,744);
  // Elapsed calendar time, refresh, discussion, source completion and recurrence
  // must never manufacture occurrence completion.
  const historyPlan = {schema_version:1,date:'2026-09-07',timezone:'America/Chicago',revision:1,blocks:[
    {id:'meeting',calendar_event_id:'recurring-event',start:'09:00',end:'10:00',kind:'work',completion_policy:'activity',title:'Send enrollment email',task_ids:[]},
    {id:'gym',start:'11:00',end:'12:00',kind:'commitment',title:'Gym',task_ids:[]}
  ]};
  const activityPlan = {...historyPlan,date:'2026-09-08',revision:2,blocks:[
    {...historyPlan.blocks[0]},
    {id:'focus',start:'10:00',end:'10:20',kind:'work',title:'Focus task block',task_ids:['task-focus']},
    {id:'travel',start:'10:20',end:'10:40',kind:'break',display:'hidden',title:'Reserved journey',task_ids:[]}
  ]};
  const activityContents = {
    'Home/Planning/today.json':JSON.stringify(activityPlan),
    'Home/Planning/history/2026-09-07-r1.json':JSON.stringify({...historyPlan,blocks:[...historyPlan.blocks,{id:'earlier-revision',title:'Earlier revision action',start:'13:00',end:'13:15',task_ids:['task-earlier-revision']}]}),
    'Home/Planning/history/2026-09-07-r2.json':JSON.stringify({...historyPlan,revision:2}),
    'Home/Planning/tasks.json':JSON.stringify({tasks:[{id:'task-focus',identity:'explicit',source:'Life/Focus.md',title:'Focus'}]}),
    'Life/Focus.md':'- [ ] Focus #me ^task-focus',
    'Home/Instructions from Boss.md':'# Instructions\n',
    'Home/Questions for Boss.md':'## Open\n## Answered\n'
  };
  const a = setup(activityContents);
  a.plugin.app.vault.getFiles = () => a.files;
  a.plugin.app.vault.create = async (name,data) => { const f = new TFile(name); a.files.push(f); activityContents[name]=data; return f; };
  const av = new context.View({},a.plugin); av.contentEl = new Element({});
  await av.refresh();
  const activityCheckbox = () => descendants(av.contentEl).find(e => e['aria-label']==='I completed Send enrollment email on 2026-09-08');
  assert.equal(activityCheckbox().checked,false);
  av.updateTimelineClock(new Date('2027-09-08T22:00:00Z'));
  await av.refresh();
  assert.equal(activityCheckbox().checked,false);
  assert(!activityContents['Home/Planning/activity-confirmations.json']);
  assert.equal((await a.plugin.collectActivityHistory(activityPlan)).length,2,'latest revision per day deduplicates history');
  assert.equal((await a.plugin.collectActivityHistory(activityPlan))[1].historical_task_titles['task-earlier-revision'],'Earlier revision action','removed blocks in older revisions preserve their unfinished task references');
  const earlier = descendants(av.contentEl).find(e=>e['aria-label']==='I completed Send enrollment email on 2026-09-07');
  assert(earlier);
  const reservedSection = descendants(av.contentEl).find(e=>e.tag==='details'&&e.children.some(c=>c.text==='Reserved time (1)'));
  reservedSection.open=true; reservedSection.ontoggle();
  assert(!descendants(reservedSection).some(e=>e.tag==='input'&&e.type==='checkbox'),'reserved time does not require checkoff');
  assert(descendants(reservedSection).some(e=>e.text==='Discuss with Atlas'));
  await assert.rejects(a.plugin.setActivityConfirmation(activityPlan,activityPlan.blocks[1],true,null),/source task checkbox/);
  await assert.rejects(a.plugin.setActivityConfirmation(historyPlan,historyPlan.blocks[1],true,null),/routine activities/);
  const sourceBefore = activityContents['Life/Focus.md'];
  let acb=activityCheckbox(); acb.checked=true; await acb.onchange();
  assert.equal(activityCheckbox().checked,true);
  assert.equal(activityContents['Life/Focus.md'],sourceBefore,'activity checkbox cannot complete project task');
  assert(descendants(av.contentEl).some(e=>e['aria-label']==='I completed Send enrollment email on 2026-09-07'),'other recurrence remains in Next actions, gym is excluded');
  let ledger=JSON.parse(activityContents['Home/Planning/activity-confirmations.json']);
  assert.equal(Object.values(ledger.confirmations)[0].evidence,'boss-checkbox');
  const reopenedActivity = new context.View({},a.plugin); reopenedActivity.contentEl=new Element({}); await reopenedActivity.refresh();
  assert(descendants(reopenedActivity.contentEl).find(e=>e['aria-label']==='I completed Send enrollment email on 2026-09-08').checked);
  const originalProcess=a.plugin.app.vault.process;
  a.plugin.app.vault.process=async()=>{throw Error('offline');};
  acb=activityCheckbox(); acb.checked=false; await acb.onchange();
  assert.equal(activityCheckbox().checked,true,'failed uncheck retains saved state');
  a.plugin.app.vault.process=originalProcess;
  acb=activityCheckbox(); acb.checked=false; await acb.onchange();
  assert.equal(activityCheckbox().checked,false);
  ledger=JSON.parse(activityContents['Home/Planning/activity-confirmations.json']);
  assert.equal(Object.values(ledger.confirmations)[0].history.length,1,'reopen retains confirmation history');
  await assert.rejects(a.plugin.setActivityConfirmation(activityPlan,activityPlan.blocks[0],true,null),/Activity changed/);
  const discussion = descendants(av.contentEl).find(e=>e.text==='Discuss with Atlas'); discussion.onclick();
  const msg = descendants(av.contentEl).find(e=>e.tag==='textarea'&&e.placeholder?.startsWith('Tell Atlas what happened'));
  msg.value='Only attended half; reschedule the remaining work.'; msg.oninput();
  await av.refresh();
  let restored = descendants(av.contentEl).find(e=>e.tag==='textarea'&&e.placeholder?.startsWith('Tell Atlas what happened'));
  assert.equal(restored.value,msg.value);
  a.plugin.app.vault.process=async()=>{throw Error('offline');};
  await descendants(av.contentEl).find(e=>e.text==='Save message').onclick();
  assert.equal(restored.value,msg.value);
  a.plugin.app.vault.process=originalProcess;
  await descendants(av.contentEl).find(e=>e.text==='Save message').onclick();
  assert(activityContents['Home/Instructions from Boss.md'].includes('Date: 2026-09-08'));
  assert(activityContents['Home/Instructions from Boss.md'].includes('Only attended half'));
  assert.equal(activityCheckbox().checked,false,'discussion never completes activity');
  assert.equal(activityContents['Life/Focus.md'],sourceBefore);
  acb=activityCheckbox(); acb.checked=true; await acb.onchange();
  activityPlan.blocks[0].title='Different work'; activityContents['Home/Planning/today.json']=JSON.stringify(activityPlan);
  await av.refresh();
  assert.equal(descendants(av.contentEl).find(e=>e['aria-label']==='I completed Different work on 2026-09-08').checked,false,'changed scope cannot inherit confirmation');
  activityContents['Home/Planning/activity-confirmations.json']='broken';
  await av.refresh();
  assert(descendants(av.contentEl).some(e=>e.text?.includes('Activity confirmations could not be read')));
  assert(descendants(av.contentEl).find(e=>e['aria-label']==='I completed Different work on 2026-09-08').disabled);
  const reviewRoot = new Element({});
  av.taskResolutions = {resolutions:{'task-retired':{disposition:'retired',evidence_ref:'Boss explicitly retired this'}}};
  const previousActions = {date:'2026-09-07',blocks:[
    {id:'email',title:'Send an email',start:'09:00',end:'10:00',kind:'work',task_ids:['task-email']},
    {id:'old',title:'Old task',start:'10:00',end:'11:00',kind:'work',task_ids:['task-retired']},
    {id:'gym',title:'Gym',start:'11:00',end:'12:00',kind:'commitment',task_ids:[]},
    {id:'class',title:'Class',start:'13:00',end:'14:00',kind:'commitment',task_ids:[]},
    {id:'ultimate',title:'Ultimate practice',start:'18:00',end:'19:00',kind:'commitment',task_ids:[]}
  ]};
  av.renderNextActions(reviewRoot,[previousActions,{...previousActions,date:'2026-09-06'}],{date:'2026-09-08',blocks:[]},[],[],{notes:[]});
  assert(descendants(reviewRoot).some(e=>e.text==='Next actions (1)'),'only consequential email remains, once across dates; routine events and explicitly retired work excluded');
  const rv=reviewRoot.children[0];
  assert(descendants(rv).some(e=>e.text==='Send an email'),'missing source keeps historical action title, not an anonymous unavailable row');
  assert(!descendants(rv).some(e=>e['aria-label']?.startsWith('I completed')),'linked source task has no duplicate activity checkbox');
  const scheduledRoot=new Element({});
  av.renderNextActions(scheduledRoot,[previousActions],{date:'2026-09-08',blocks:[],unscheduled_task_ids:['task-email']},[],[],{notes:[]});
  assert.equal(descendants(scheduledRoot).filter(e=>e.tag==='input'&&e.type==='checkbox').length,1,'current and historical Next actions deduplicate');
  const identityContents = {'Life/Moved.md':'- [x] Finished #me ^task-done ✅ 2026-09-22\n- [ ] Renamed title #me ^task-moved 📅 2026-09-23\n- [/] Claimed #me ^task-claim ⏳ agent\n- [ ] Restored #me ^task-restored\n'};
  const identity=setup(identityContents), identityScan=await identity.plugin.scanNotes(), identityTasks=await identity.plugin.collectTasks(identityScan);
  const iv=new context.View({},identity.plugin);
  iv.taskResolutions={resolutions:{'task-retired':{disposition:'retired',evidence_ref:'owner decision'},'task-restored':{disposition:'completed',evidence_ref:'older completion'}}};
  const ir=new Element({});
  iv.renderSourceTasks(ir,['task-done','task-moved','task-claim','task-retired','task-restored'],[{id:'task-moved',identity:'explicit',source:'Life/Old.md',title:'Old title'}],identityTasks,identityScan);
  assert.equal(descendants(ir).filter(e=>e.tag==='input').length,3,'live completed and retired references disappear even when index is absent');
  assert(descendants(ir).some(e=>e.text==='Renamed title'),'live moved/renamed source wins over stale index');
  assert.equal(descendants(ir).find(e=>e['aria-label']==='Claimed ⏳ agent').disabled,true,'claim metadata after anchor retains identity');
  assert.equal(descendants(ir).find(e=>e['aria-label']==='Restored').disabled,false,'reopened live source wins over old completion resolution');
  iv.taskResolutions.resolutions['task-old-alias']={status:'completed',evidence_ref:'saved source evidence'};
  iv.taskResolutions.resolutions['task-replaced']={status:'replaced',evidence_ref:'saved replacement evidence',replacement_task_ids:['task-restored']};
  const replacements=new Element({});
  iv.renderNextActions(replacements,[{date:'2026-09-07',blocks:[],unscheduled_task_ids:['task-old-alias','task-replaced']}],{date:'2026-09-08',blocks:[]},[],identityTasks,identityScan);
  assert.equal(descendants(replacements).filter(e=>e.tag==='input').length,1,'legacy status resolutions work and an open replacement stays visible');
  assert(descendants(replacements).some(e=>e.text==='Restored'));
  const moved=identityTasks.find(t=>t.raw.includes('^task-moved'));
  await identity.plugin.toggleTask(moved);
  assert(identityContents['Life/Moved.md'].includes('✅ 2026-09-08 ^task-moved'),'completion preserves ID at end after due metadata');
  console.log('PASS: merged Next actions, missing-index completion, metadata suffixes, moved sources, claims and reopened tasks');
  console.log('PASS: explicit occurrence confirmation, recurrence isolation, history, reserved controls, reopen, stale-write guard, contextual discussion, draft/error recovery and corrupt-state handling');
  console.log('PASS: task/question parsing, drafts/errors, mobile activation, Today source completion, stable IDs, durable instructions/drafts, Seen persistence/failure recovery, hidden transitions and diagnostics');
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
  assert.equal(scan.errors.length, 0);
  assert(tasks.length > 100);
  assert(unfinished.length > 0);
  console.log(JSON.stringify({ scanned: scan.notes.length, tasks: tasks.length, pendingQuestions: questions.filter(q => !q.answered).length, unfinished: unfinished.length, readErrors: scan.errors.length }));
}
tests().then(() => process.argv[2] && actualVault(path.resolve(process.argv[2]))).catch(e => { console.error(e); process.exitCode = 1; });
