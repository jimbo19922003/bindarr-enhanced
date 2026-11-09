'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const FILE='data-asia/BW/BW3b.ts',BEFORE='e731fefb7dffb273cc92ae0415a063f7fe0680c8',AFTER='4fb8997cefb0ddd743cca660744201b35b800c3f';
const SUPPORTED=['en','fr','es','es-mx','it','pt','pt-br','pt-pt','de','nl','pl','ru','ja','ko','zh-tw','id','th','zh-cn'];
const ASIAN=new Set(['ja','ko','zh-tw','id','th','zh-cn']);
const blob=bytes=>createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
function parseLanguages(input='en'){const languages=String(input).trim().split(/[,\s]+/);if(!languages.length||new Set(languages).size!==languages.length||languages.some(l=>!SUPPORTED.includes(l)))throw new Error('Invalid explicit compiler languages');return languages;}
const historyFolders=languages=>[...new Set(languages.map(l=>ASIAN.has(l)?'data-asia':'data'))];
function historyBlock(languages){return '\tconst files: Array<string> = []\n\tfor (const folder of '+JSON.stringify(historyFolders(languages))+') {\n\t\tconst command = \'git ls-tree -r --name-only HEAD ../\' + folder\n\t\tfiles.push(...(await runCommand(command)).split(\'\\n\').filter(file => file.trim().length > 0))\n\t}\n\t';}
function scopedIndex(text,languages){const pattern=/const LANGS: Array<SupportedLanguages> = \[[\s\S]*?\n\]/;if(!pattern.test(text))throw new Error('Unknown upstream compiler language declaration');return text.replace(pattern,'const LANGS: Array<SupportedLanguages> = '+JSON.stringify(languages));}
function scopedHistory(text,languages){const start=text.indexOf("\tconst firstCommand = 'git ls-tree"),end=text.indexOf("console.log('Loaded files tree'",start);if(start<0||end<start)throw new Error('Unknown upstream history loader');text=text.slice(0,start)+historyBlock(languages)+text.slice(end);const diagnostic=/^([ \t]*)console\.warn\('could not load file', file, 'hope it does not break everything else lol'\)[ \t]*$/gm;if((text.match(diagnostic)||[]).length!==1)throw new Error('Unknown upstream history diagnostic');return text.replace(diagnostic,(_match,indent)=>indent+"console.warn('Could not read Git last-edit metadata for', file)");}
function scopeCompiler(root,languages){
 const definitions=[['server/compiler/index.ts','582d190542cac47c1a0ff9b378c72ad12d8e3ec5',scopedIndex],['server/compiler/utils/util.ts','a3279e95b7d05542722121396c01bbf3b59c0a6d',scopedHistory]],edits=[];
 for(const [name,expected,transform] of definitions){const file=path.join(root,name),resolved=fs.realpathSync(file);if(!resolved.startsWith(root+path.sep)||fs.lstatSync(file).isSymbolicLink())throw new Error('Compiler source escapes checkout');const bytes=fs.readFileSync(file);if(blob(bytes)!==expected)throw new Error('Unreviewed upstream compiler source: '+name);const updated=Buffer.from(transform(bytes.toString('utf8'),languages));edits.push({file,bytes:updated,record:{path:name,beforeGitBlob:expected,afterGitBlob:blob(updated)}});}
 for(const edit of edits)fs.writeFileSync(edit.file,edit.bytes);
 return {languages,historyFolders:historyFolders(languages),sourceEdits:edits.map(e=>e.record)};
}
function correctDefinition(input){
 const hash=blob(input);let bytes=input,applied=false;
 if(hash===BEFORE){const original=input.toString('utf8'),old="\tid: 'BW3a',";if(original.split(old).length!==2)throw new Error('Unexpected BW3b ID declaration');bytes=Buffer.from(original.replace(old,"\tid: 'BW3b',"));if(blob(bytes)!==AFTER)throw new Error('BW3b correction hash mismatch');applied=true;}
 else if(hash!==AFTER)throw new Error('Unreviewed upstream BW3b definition; review the correction before building');
 return {bytes,record:{path:FILE,beforeGitBlob:BEFORE,afterGitBlob:AFTER,applied}};
}
function correctBW8Definition(input){
 const before='fcc0f3e7ef47373c8bcedaa2f134eeeb8d99cffd',after='8baa099613ebdf5a50904340583224e2762a4f7a',hash=blob(input);let bytes=input,applied=false;
 if(hash===before){const text=input.toString('utf8'),old="\tid: 'BW8a',";if(text.split(old).length!==2)throw new Error('Unexpected BW8b ID declaration');bytes=Buffer.from(text.replace(old,"\tid: 'BW8b',"));if(blob(bytes)!==after)throw new Error('BW8b correction hash mismatch');applied=true;}
 else if(hash!==after)throw new Error('Unreviewed upstream BW8b definition; review before building');
 return {bytes,record:{path:'data-asia/BW/BW8b.ts',beforeGitBlob:before,afterGitBlob:after,applied}};
}
function applyBW8(root){
 const file=path.join(root,'data-asia/BW/BW8b.ts'),resolved=fs.realpathSync(file);
 if(!resolved.startsWith(root+path.sep)||fs.lstatSync(file).isSymbolicLink())throw new Error('Correction target escapes checkout');
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>16384)throw new Error('Invalid BW8b correction target');
 const result=correctBW8Definition(fs.readFileSync(file));if(result.record.applied)fs.writeFileSync(file,result.bytes);return result.record;
}
function apply(sourceRoot,outputRoot){
 const root=fs.realpathSync(sourceRoot),file=path.join(root,FILE),resolved=fs.realpathSync(file);
 if(!resolved.startsWith(root+path.sep)||fs.lstatSync(file).isSymbolicLink())throw new Error('Correction target escapes source checkout');
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>16384)throw new Error('Invalid correction target');
 const result=correctDefinition(fs.readFileSync(file));
 fs.mkdirSync(outputRoot,{recursive:true});
 fs.writeFileSync(path.join(outputRoot,'UPSTREAM-CORRECTIONS.json'),JSON.stringify({schemaVersion:1,corrections:[result.record]},null,2)+'\n',{flag:'wx'});
 if(result.record.applied)fs.writeFileSync(file,result.bytes);
 return result.record;
}
function prepare(sourceRoot,outputRoot,input){const root=fs.realpathSync(sourceRoot),languages=parseLanguages(input),compilerScope=scopeCompiler(root,languages),asian=languages.some(l=>ASIAN.has(l));fs.mkdirSync(outputRoot,{recursive:true});const filename=path.join(outputRoot,'UPSTREAM-CORRECTIONS.json');if(asian)apply(root,outputRoot);else fs.writeFileSync(filename,JSON.stringify({schemaVersion:1,corrections:[]}),{flag:'wx'});const report=JSON.parse(fs.readFileSync(filename,'utf8'));if(asian)report.corrections.push(applyBW8(root));report.compilerScope=compilerScope;fs.writeFileSync(filename,JSON.stringify(report,null,2)+'\n');return report;}
if(require.main===module){try{const [root,out,...extra]=process.argv.slice(2);if(!root||!out||extra.length)throw new Error('Usage: apply-catalog-corrections.js <source-root> <output-root>');console.log(JSON.stringify(prepare(root,out,process.env.BUNDLE_LANGUAGES===undefined?'en':process.env.BUNDLE_LANGUAGES)));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={correctDefinition,correctBW8Definition,apply,prepare,parseLanguages,historyFolders,historyBlock,scopedIndex,scopedHistory};
