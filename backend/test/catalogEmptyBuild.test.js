'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

test('an empty artwork selection is an error and never writes or reloads a scan index',async()=>{
 let writes=0,inferences=0,reloads=0;
 const filename=path.join(__dirname,'../src/catalog.js');
 const modules={
  fs:{...fs,writeFileSync:()=>{writes++;throw new Error('Unexpected index write');},renameSync:()=>{writes++;throw new Error('Unexpected index replacement');}},
  path,
  sharp:()=>{throw new Error('Unexpected image processing');},
  'onnxruntime-node':{InferenceSession:{create:async()=>{inferences++;throw new Error('Unexpected model startup');}}},
  './db':{all:async()=>[]},
  './cardSets':{},
  './utils/languages':{toName:language=>language||'English'},
  './cvScan':{reload:()=>{reloads++;}},
  './utils/pokemonProvider':{},
 };
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,__dirname:path.dirname(filename),process:{env:{}},console:{log:()=>{},warn:()=>{},error:()=>{}},require:name=>{if(!Object.hasOwn(modules,name))throw new Error('Unexpected dependency: '+name);return modules[name];}},{filename});
 const api=module.exports;
 api.start('pokemon','English',{sets:['base1'],skipCache:true});
 for(let attempt=0;attempt<20&&api.state();attempt++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(api.state(),null,'build should finish');
 const result=api.lastResult();
 assert.equal(result.phase,'error');
 assert.match(result.message,/No eligible card artwork/);
 assert.match(result.message,/pokemon\/English/);
 assert.match(result.message,/base1/);
 assert.match(result.message,/No scan catalog was written/);
 assert.equal(writes,0);assert.equal(inferences,0);assert.equal(reloads,0);
});
