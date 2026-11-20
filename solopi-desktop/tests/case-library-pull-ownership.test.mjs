import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mergePulledCaseLibraryIntoStateForCli} from '../scripts/glassbox-cli.mjs';
const require=createRequire(import.meta.url);
const guard=require('../electron/case-edit-guard');

test('pull replaces only its owning library and preserves protected unfiled/local/other-library cases',()=>{
 const local={id:'unfiled',libraryId:'case-library-local',folderId:'',name:'saved local',steps:[]};
 const implicit={id:'implicit-local',folderId:'',name:'unfiled without explicit owner',steps:[]};
 const other={id:'other',libraryId:'other-library',folderId:'case-folder-default',name:'explicit owner wins',steps:[]};
 const old={id:'old-target',folderId:'case-folder-default',steps:[]};
 const displaced={id:'displaced-target',libraryId:'target',folderId:'elsewhere',steps:[]};
 const state={caseLibraries:[{id:'target'},{id:'case-library-local'},{id:'other-library'}],caseFolders:[{id:'case-folder-default',libraryId:'target'}],cases:[local,implicit,other,old,displaced],components:[],caseEdges:{unfiled:[{source:'start',target:'end'}]},nodePositions:{unfiled:{start:{x:1,y:2}}},deviceBindings:{phoneSerials:['keep']},caseEditGuards:{unfiled:{libraryId:'case-library-local'},other:{libraryId:'other-library'}}};
 const before=JSON.stringify(state);
 const incoming={id:'new-target',folderId:'case-folder-default',steps:[]};
 const next=mergePulledCaseLibraryIntoStateForCli(state,{id:'target'},{libraryId:'target',folders:[{id:'case-folder-default',libraryId:'target'}],cases:[incoming],components:[],caseEdges:{},nodePositions:{}},{commitHash:'source-revision'});
 assert.deepEqual(next.cases.map(c=>c.id),['unfiled','implicit-local','other','new-target']);
 assert.equal(next.cases[0],local);assert.equal(next.cases[1],implicit);assert.equal(next.cases[2],other);
 assert.deepEqual(next.caseEdges.unfiled,state.caseEdges.unfiled);assert.deepEqual(next.nodePositions.unfiled,state.nodePositions.unfiled);assert.equal(next.deviceBindings,state.deviceBindings);
 for(const library of next.caseLibraries)assert.doesNotThrow(()=>guard.assertLibraryApplySafe(state,{libraryId:library.id,cases:next.cases.filter(c=>guard.libraryOf(next,c)===library.id),caseEdges:next.caseEdges,components:next.components}));
 assert.equal(JSON.stringify(state),before);
 assert.equal(next.caseLibraries.find(l=>l.id==='target').lastCommit,'source-revision');
});
