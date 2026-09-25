// Isolated browser acceptance: actual plugin code, synthetic notes only.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = process.argv[2];
(async () => {
  const browser = await chromium.launch({headless:true});
  const results = [];
  try {
    for (const width of [320, 390, 800]) {
      const context = await browser.newContext({viewport:{width,height:900},hasTouch:width<800,isMobile:width<800});
      const page = await context.newPage();
      const errors = []; page.on('pageerror',e=>errors.push(e.message));
      await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main></main>');
      await page.addStyleTag({content:':root{--background-primary:#fff;--background-secondary:#eee;--background-modifier-border:#aaa;--text-normal:#222;--text-muted:#555;--interactive-accent:#6152b5;--font-ui-small:14px;--font-ui-smaller:12px}body{margin:0;font-family:Arial;background:var(--background-primary);color:var(--text-normal)}main{height:900px;overflow:auto}button,select,textarea{font:inherit;color:inherit}'});
      await page.addStyleTag({path:path.join(__dirname,'styles.css')});
      await page.evaluate(() => {
        HTMLElement.prototype.createEl=function(tag,o={}){const e=document.createElement(tag);if(o.cls)e.className=o.cls;if(o.text)e.textContent=o.text;for(const[k,v]of Object.entries(o.attr||{}))e.setAttribute(k,v);this.append(e);return e;};
        HTMLElement.prototype.createDiv=function(o){return this.createEl('div',o);};
        HTMLElement.prototype.createSpan=function(o){return this.createEl('span',o);};
        HTMLElement.prototype.empty=function(){this.replaceChildren();};
        HTMLElement.prototype.addClass=function(c){this.classList.add(c);};
        window.TFile=class{constructor(p){this.path=p;this.basename=p.split('/').pop();this.parent={name:'Home'};this.stat={mtime:1};}};
        window.notices=[];
        window.module={exports:{}};
        window.require=()=>({Plugin:class{},ItemView:class{},PluginSettingTab:class{},TFile,Platform:{isMobile:false},normalizePath:s=>s,parseYaml:()=>({}),Notice:class{constructor(s){notices.push(s);}},moment:()=>({format:()=> '2026-09-22'})});
      });
      await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'main.js'),'utf8')+'\nwindow.TestView=AtlasView;'});
      await page.evaluate(async()=>{
        window.contents={
          'Home/Questions for Boss.md':'## Open\n- A fixture question? [priority:: high]\n',
          'Home/Instructions from Boss.md':'# Instructions\n',
          'Life/Tasks.md':'- [ ] First fixture action #me ^task-first\n- [ ] Second fixture action #me ^task-second\n- [ ] Third fixture action #me ^task-third\n',
          'Home/Agents/old/before/Tasks.md':'- [ ] First fixture action #me ^task-first\n',
          'Home/Planning/today.json':JSON.stringify({schema_version:1,date:'2026-09-22',blocks:[],unscheduled_task_ids:['task-first','task-second','task-third'],session_update:{id:'fixture-notice',text:'Important facts appear here.',details:['Campus parking changes Friday and Saturday.','A confirmed deadline moved to next Tuesday.','<b>This remains plain text.</b>']}})
        };
        const files=Object.keys(contents).map(p=>new TFile(p));
        window.plugin=new module.exports.default();plugin.settings={...plugin.settings};
        window.failWrite=false; window.writes=0;
        plugin.app={vault:{getName:()=> 'Fixture',getFiles:()=>files,getMarkdownFiles:()=>files.filter(f=>f.path.endsWith('.md')),getAbstractFileByPath:p=>files.find(f=>f.path===p),read:async f=>contents[f.path],cachedRead:async f=>contents[f.path],process:async(f,fn)=>{writes++;await new Promise(r=>setTimeout(r,20));if(failWrite)throw Error('Fixture disk unavailable');contents[f.path]=fn(contents[f.path]);}},metadataCache:{getFileCache:()=>null},workspace:{}};
        window.view=new TestView({},plugin);view.contentEl=document.querySelector('main');await view.refresh();
        window.initialInput=view.addInput; window.initialCheckbox=document.querySelector('.an-untimed input');
        window.scan=plugin.scanNotes.bind(plugin);
      });
      await page.evaluate(async()=>{for(let i=0;i<5;i++)await view.refresh({background:true});});
      assert(await page.evaluate(()=>initialInput===view.addInput),'No-op events replaced DOM');
      const disclosure=page.locator('.an-update-details');
      assert(!(await disclosure.evaluate(e=>e.open)),'Notices start collapsed');
      await disclosure.locator('summary').focus(); await page.keyboard.press('Enter');
      assert(await disclosure.evaluate(e=>e.open),'Keyboard opens notices');
      assert.equal(await disclosure.locator('li').count(),3);
      assert.equal(await disclosure.locator('b').count(),0,'Notice strings cannot inject markup');
      const disclosureRect=await disclosure.locator('summary').boundingBox();assert(disclosureRect.height>=44);
      if(output) await page.screenshot({path:path.join(output,`atlas-tasks-${width}.png`),fullPage:true});
      const input=page.locator('.an-instruction textarea');
      await input.fill('Keep this draft and selection');
      await input.evaluate(e=>e.setSelectionRange(5,9));
      await page.evaluate(async()=>{contents['Life/Tasks.md']+='\nA note changed';await view.refresh({background:true});});
      assert(await page.evaluate(()=>view.addInput===initialInput && document.activeElement===initialInput && initialInput.selectionStart===5),'Background refresh disrupted typing');
      await input.evaluate(e=>e.blur());
      await page.evaluate(()=>view.refresh());
      const first=page.locator('.an-untimed input[type=checkbox]').first();
      assert(await first.isEnabled(),'Backup duplicate disabled the checkbox');
      const target=first.locator('..');
      const rect=await target.boundingBox(); assert(rect.width>=44 && rect.height>=44);
      // Start a read, then hold the pointer while it completes. Mouse-up must
      // still reach the exact original checkbox, including when metadata moved.
      await page.evaluate(()=>{plugin.scanNotes=()=>new Promise(r=>window.releaseScan=r);window.pending=view.refresh({background:true});window.held=document.querySelector('.an-untimed input');});
      const cbRect=await first.boundingBox();
      await page.mouse.move(cbRect.x+cbRect.width/2,cbRect.y+cbRect.height/2); await page.mouse.down();
      await page.evaluate(async()=>{releaseScan(await scan());await pending;plugin.scanNotes=scan;contents['Life/Tasks.md']=contents['Life/Tasks.md'].replace('^task-first','^task-first 📅 2026-09-23');});
      assert(await page.evaluate(()=>held.isConnected),'Held pointer target detached');
      await page.mouse.up();
      await page.waitForFunction(()=>contents['Life/Tasks.md'].includes('[x] First fixture action'));
      await page.waitForFunction(()=>!document.querySelector('.an-untimed')?.textContent.includes('First fixture action'));
      assert(await page.evaluate(()=>contents['Life/Tasks.md'].includes('📅 2026-09-23')));
      assert(await page.evaluate(()=>document.querySelector('main').contains(document.activeElement)),'Completion lost keyboard focus');
      // A failed save remains unchecked and retryable, with a visible reason.
      await page.evaluate(()=>{failWrite=true;});
      await page.locator('.an-untimed input').first().check();
      await page.waitForFunction(()=>notices.some(s=>s.includes('Could not complete task')));
      assert(!(await page.locator('.an-untimed input').first().isChecked()));
      assert(await page.locator('.an-untimed input').first().isEnabled());
      await page.evaluate(()=>{failWrite=false;});
      const secondTarget=page.locator('.an-untimed .an-task-check').first();
      if(width<800) await secondTarget.tap({position:{x:3,y:3}}); else await secondTarget.click({position:{x:3,y:3}});
      await page.waitForFunction(()=>contents['Life/Tasks.md'].includes('[x] Second fixture action'));
      await page.waitForFunction(()=>document.querySelectorAll('.an-untimed input').length===1);
      await page.locator('.an-untimed input').focus(); await page.keyboard.press('Space');
      await page.waitForFunction(()=>contents['Life/Tasks.md'].includes('[x] Third fixture action'));
      await page.waitForFunction(()=>!view.pendingTaskWrites && !view.refreshRunning);
      assert.equal(await input.inputValue(),'Keep this draft and selection');
      for(const dark of [false,true]) {
        await page.evaluate(dark=>document.documentElement.style.cssText=dark?'--background-primary:#222;--background-secondary:#333;--text-normal:#eee;--text-muted:#bbb;--background-modifier-border:#666':'',dark);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.querySelector('main').scrollWidth<=innerWidth));
        if(output) await page.screenshot({path:path.join(output,`atlas-${width}-${dark?'dark':'light'}.png`),fullPage:true});
      }
      assert.equal(errors.length,0,errors.join('\n'));
      assert(await page.evaluate(()=>notices.every(s=>s.includes('Could not complete task'))),'Unexpected plugin error');
      results.push({width,target:{width:rect.width,height:rect.height},heldClick:true,touchRetry:true,keyboardCompletion:true,draftRetained:true,pageErrors:errors});
      await page.evaluate(()=>view.onClose()); await context.close();
    }
    if(output)fs.writeFileSync(path.join(output,'browser-verification.json'),JSON.stringify(results,null,2));
    console.log('PASS: real DOM pointer race, 44px label taps, keyboard completion, failed-save retry, draft/caret retention, focus, light/dark and no overflow at 320/390/800px');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
