'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const FILE='data-asia/BW/BW3b.ts',BEFORE='e731fefb7dffb273cc92ae0415a063f7fe0680c8',AFTER='4fb8997cefb0ddd743cca660744201b35b800c3f';
const blob=bytes=>createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
function correctDefinition(input){
 const hash=blob(input);let bytes=input,applied=false;
 if(hash===BEFORE){const original=input.toString('utf8'),old="\tid: 'BW3a',";if(original.split(old).length!==2)throw new Error('Unexpected BW3b ID declaration');bytes=Buffer.from(original.replace(old,"\tid: 'BW3b',"));if(blob(bytes)!==AFTER)throw new Error('BW3b correction hash mismatch');applied=true;}
 else if(hash!==AFTER)throw new Error('Unreviewed upstream BW3b definition; review the correction before building');
 return {bytes,record:{path:FILE,beforeGitBlob:BEFORE,afterGitBlob:AFTER,applied}};
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
if(require.main===module){try{const [root,out,...extra]=process.argv.slice(2);if(!root||!out||extra.length)throw new Error('Usage: apply-catalog-corrections.js <source-root> <output-root>');console.log(JSON.stringify(apply(root,out)));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={correctDefinition,apply};
