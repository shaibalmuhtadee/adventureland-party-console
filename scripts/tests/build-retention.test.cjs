const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {classes, digest, verifyManifest} = require('../../tools/game/manifest.ts');
const {rememberGame, cleanGame, gameHistory, rollbackGame, resumeGame} = require('../../tools/game/history.ts');
const {atomicJson, withBuildLock, inspectRemoval, applyRemovals} = require('../../tools/build-store.ts');
const {rememberDashboard, cleanDashboard, dashboardHistory, pinDashboard} = require('../../tools/dashboard/history.ts');

async function fixture(action) {
 const base=path.resolve('.build/test-retention'); await fs.mkdir(base,{recursive:true});
 const root=await fs.mkdtemp(path.join(base,'store-'));
 try {await action(root);} finally {await applyRemovals(base,[await inspectRemoval(base,path.relative(base,root))]);}
}
async function generation(directory,n) {
 const entries={};
 for(const name of classes) {
  const source=`// ${name} ${n}`,sha256=digest(source),file=`generated/${sha256}/${name}.js`;
  await fs.mkdir(path.dirname(path.join(directory,file)),{recursive:true});await fs.writeFile(path.join(directory,file),source);
  entries[name]={file,sha256,inputs:[]};
 }
 const manifest={schema:1,generation:digest(classes.map(name=>name+':'+entries[name].sha256).join('\n')),classes:entries};
 await rememberGame(directory,manifest);return manifest;
}
test('keeps 20 distinct complete game builds plus a pinned older current build; preview is read-only',()=>fixture(async root=>{
 const directory=path.join(root,'characters'),versions=[];
 for(let i=0;i<23;i++) versions.push(await generation(directory,i));
 await atomicJson(path.join(directory,'manifest.json'),versions[0]);
 await rememberGame(directory,versions[22]);assert.equal((await gameHistory(directory)).length,23);
 const preview=await cleanGame(directory,false);assert.equal(preview.retained.length,21);assert.equal(preview.removals.length,14);
 await verifyManifest(directory,versions[1]);await cleanGame(directory,true);
 await assert.rejects(verifyManifest(directory,versions[1]),/ENOENT/);
 await verifyManifest(directory,versions[0]);await verifyManifest(directory,versions[22]);
 assert.equal((await cleanGame(directory,false)).removals.length,0);
}));
test('rollback verifies chosen build, pins publication, and resume publishes staged build',()=>fixture(async root=>{
 const directory=path.join(root,'characters'),a=await generation(directory,1),b=await generation(directory,2);
 await atomicJson(path.join(directory,'manifest.json'),b);
 const staged=path.join(root,'.build/game'),latest=await generation(staged,3);
 await atomicJson(path.join(staged,'manifest.json'),latest);
 await rollbackGame(root,a.generation);
 assert.equal(JSON.parse(await fs.readFile(path.join(directory,'manifest.json'))).generation,a.generation);
 assert.equal(JSON.parse(await fs.readFile(path.join(staged,'publication.json'))).pinned,a.generation);
 await fs.appendFile(path.join(directory,b.classes.mage.file),'corrupt');
 await assert.rejects(rollbackGame(root,b.generation),/checksum/);
 assert.equal(JSON.parse(await fs.readFile(path.join(directory,'manifest.json'))).generation,a.generation);
 // Corrupt retained artifacts stop cleanup too; restore the fixture before resuming.
 await fs.writeFile(path.join(directory,b.classes.mage.file),'// mage 2');
 await resumeGame(root);assert.equal(JSON.parse(await fs.readFile(path.join(directory,'manifest.json'))).generation,latest.generation);
 assert.equal(JSON.parse(await fs.readFile(path.join(staged,'publication.json'))).pinned,null);
}));
test('unknown files survive and corrupt current manifests prevent all deletion',()=>fixture(async root=>{
 const directory=path.join(root,'characters'),current=await generation(directory,1),old=await generation(directory,2);
 await atomicJson(path.join(directory,'manifest.json'),current);
 const unknown=path.join(directory,path.dirname(old.classes.mage.file),'notes.txt');await fs.writeFile(unknown,'keep');
 await fs.writeFile(path.join(directory,current.classes.mage.file),'bad');
 await assert.rejects(cleanGame(directory,true),/checksum/);assert.equal(await fs.readFile(unknown,'utf8'),'keep');
 await verifyManifest(directory,old);
}));
// Filesystem isolation exercises real casing and junctions without deleting live builds.
// Failure modes: casing rejects an ordinary Windows root; redirected roots or
// descendants permit deletion; escaped paths or the root itself permit deletion.
test('cleanup accepts Windows root casing differences', {skip: process.platform !== 'win32'},()=>fixture(async root=>{
 const mixedRoot=path.join(path.dirname(root),path.basename(root).toUpperCase());
 await fs.writeFile(path.join(root,'obsolete.txt'),'old');
 const removal=await inspectRemoval(mixedRoot,'obsolete.txt');
 assert.equal(removal.bytes,3);
 await applyRemovals(mixedRoot,[removal]);
 await assert.rejects(fs.access(path.join(root,'obsolete.txt')),/ENOENT/);
 await fs.access(root);
}));
test('store lock excludes concurrent mutation and cleanup refuses escaped paths and junctions',()=>fixture(async root=>{
 await withBuildLock(root,async()=>{await assert.rejects(withBuildLock(root,async()=>{}),/locked/);});
 await assert.rejects(inspectRemoval(root,'../outside'),/escaped/);
 await assert.rejects(inspectRemoval(root,'.'),/escaped/);
 const target=path.join(root,'target');await fs.mkdir(target);
 const link=path.join(root,'link');await fs.symlink(target,link,'junction');
 await fs.writeFile(path.join(target,'keep.txt'),'keep');
 try {
  await assert.rejects(inspectRemoval(root,'link'),/links/);
  await assert.rejects(inspectRemoval(link,'keep.txt'),/redirected/);
  assert.equal(await fs.readFile(path.join(target,'keep.txt'),'utf8'),'keep');
 } finally {await fs.unlink(link);}
}));
test('dashboard retains 20 releases plus live older versions, removes validation but preserves settings',()=>fixture(async root=>{
 const ids=[];
 for(let i=0;i<23;i++) {
  const id=i.toString(16).padStart(20,'0');ids.push(id);
  const release=path.join(root,'.build/releases',id);await fs.mkdir(path.join(release,'server'),{recursive:true});
  await atomicJson(path.join(release,'server/index.js'),{});await atomicJson(path.join(release,'complete.json'),{generation:id});
  await rememberDashboard(root,id);
 }
 await pinDashboard(root,3020,[ids[0]]);
 await atomicJson(path.join(root,'.build/mode.json'),{mode:'production'});
 await atomicJson(path.join(root,'.build/validation/output.json'),{});
 const preview=await cleanDashboard(root,[ids[1]],false);assert.equal(preview.retained.length,22);
 assert.equal(preview.removals.length,2);
 await cleanDashboard(root,[ids[1]],true);
 assert.equal((await dashboardHistory(root)).length,22);
 await fs.access(path.join(root,'.build/mode.json'));
 await assert.rejects(fs.access(path.join(root,'.build/releases',ids[2])),/ENOENT/);
 await fs.access(path.join(root,'.build/releases',ids[0]));
}));
test('dashboard rollback selects the requested release and restores pin on startup failure',async()=>{
 const source=await fs.readFile('tools/dashboard/supervisor.mts','utf8');
 const start=source.indexOf('async function changeMode('),end=source.indexOf('async function handleBuilds(',start);
 const ts=require('typescript'),vm=require('node:vm');
 const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const fail of [false,true]) {
  let selected,activated=false,rejected=false;
  const context=vm.createContext({busy:false,failure:null,rollbackSelection:'old',active:{mode:'production'},
   restoreDevelopment:async()=>false,createCandidate:async(_mode,id)=>{selected=id;return {generation:id};},
   activate:async()=>{if(fail)throw Error('unhealthy');activated=true;},
   rejectCandidate:async()=>{rejected=true;},saveMode:async()=>{},pin:async()=>{}});
  vm.runInContext(code,context);
  if(fail)await assert.rejects(context.changeMode('production','chosen'),/unhealthy/);
  else await context.changeMode('production','chosen');
  assert.equal(selected,'chosen');assert.equal(activated,!fail);assert.equal(rejected,fail);
  assert.equal(context.rollbackSelection,fail?'old':'chosen');assert.equal(context.busy,false);
 }
});
