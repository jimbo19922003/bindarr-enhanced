'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{constants}=require('node:fs'),{createHash,randomUUID}=require('node:crypto');
const {LANGUAGES}=require('./languages'),{normalize}=require('./pokemonLocalCatalog');
const SOURCE='tcgdex/cards-database',SHA=/^[a-f0-9]{40}$/,DIGEST=/^[a-f0-9]{64}$/;
const LIMITS={cards:128*1024*1024,sets:32*1024*1024,manifest:1024*1024,license:65536};
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
function identity(commit,language){if(!SHA.test(commit||''))throw new TypeError('Expected a pinned upstream commit');if(!LANGUAGES.some(l=>l.code===language))throw new TypeError('Unsupported bundle language');}
async function readBounded(root,relative,max){
 const base=await fs.realpath(root),filename=await fs.realpath(path.join(base,relative));
 if(!filename.startsWith(base+path.sep))throw new Error('Bundle file escapes its directory');
 const handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>max)throw new Error('Bundle file exceeds size limit or is not a regular file');let size=0;const chunks=[];for await(const chunk of handle.createReadStream({autoClose:false})){size+=chunk.length;if(size>max)throw new Error('Bundle file grew past size limit');chunks.push(chunk);}return Buffer.concat(chunks);}finally{await handle.close();}
}
function array(buffer,label,max){const rows=JSON.parse(buffer.toString('utf8'));if(!Array.isArray(rows)||!rows.length||rows.length>max)throw new Error('Invalid '+label+' export');return rows;}
function license(buffer){const text=buffer.toString('utf8');if(!text.includes('MIT License')||!text.includes('TCGdex')||!text.includes('permission notice'))throw new Error('Missing upstream MIT notice');}
function validateCards(cards){for(const card of cards){if(typeof card.id!=='string'||typeof card.localId!=='string'||typeof card.set?.id!=='string'||card.id!==`${card.set.id}-${card.localId}`)throw new Error('Compiled card identity differs from set and collector number');}}
async function checked(root,relative,descriptor,max){if(!descriptor||!DIGEST.test(descriptor.sha256||'')||!Number.isSafeInteger(descriptor.bytes)||descriptor.bytes<1||descriptor.bytes>max)throw new Error('Invalid bundle file descriptor');const bytes=await readBounded(root,relative,max);if(bytes.length!==descriptor.bytes||digest(bytes)!==descriptor.sha256)throw new Error('Bundle checksum mismatch: '+relative);return bytes;}
async function writeBundleManifest({directory,commit,languages}){
 if(!Array.isArray(languages)||!languages.length||new Set(languages).size!==languages.length)throw new TypeError('Choose explicit unique bundle languages');
 const notice=await readBounded(directory,'LICENSE',LIMITS.license);license(notice);
 const manifest={schemaVersion:1,source:SOURCE,commit,license:{sha256:digest(notice),bytes:notice.length},languages:{}};
 for(const language of languages){identity(commit,language);const entry={};let cards,sets;
  for(const kind of ['cards','sets']){const bytes=await readBounded(directory,`${language}/${kind}.json`,LIMITS[kind]);const rows=array(bytes,kind,kind==='cards'?500000:10000);entry[kind]={sha256:digest(bytes),bytes:bytes.length,count:rows.length};if(kind==='cards')cards=rows;else sets=rows;}
  validateCards(cards);normalize({commit,language,cards,sets});manifest.languages[language]=entry;
 }
 const root=await fs.realpath(directory),temporary=path.join(root,`.manifest-${randomUUID()}.tmp`);
 try{await fs.writeFile(temporary,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});await fs.rename(temporary,path.join(root,'manifest.json'));}finally{await fs.unlink(temporary).catch(()=>{});}
 return manifest;
}
function createCompiledSnapshotLoader({directory}){
 if(typeof directory!=='string'||!directory)throw new TypeError('An explicit compiled bundle directory is required');
 return async function loadSnapshot({commit,language}){
  identity(commit,language);const manifest=JSON.parse((await readBounded(directory,'manifest.json',LIMITS.manifest)).toString('utf8'));
  if(manifest.schemaVersion!==1||manifest.source!==SOURCE||manifest.commit!==commit)throw new Error('Bundle provenance mismatch');
  if(!manifest.languages||!Object.hasOwn(manifest.languages,language))throw new Error('Requested language is absent from bundle');
  const entry=manifest.languages[language];const notice=await checked(directory,'LICENSE',manifest.license,LIMITS.license);license(notice);
  const cards=array(await checked(directory,`${language}/cards.json`,entry.cards,LIMITS.cards),'cards',500000),sets=array(await checked(directory,`${language}/sets.json`,entry.sets,LIMITS.sets),'sets',10000);
  if(cards.length!==entry.cards.count||sets.length!==entry.sets.count)throw new Error('Bundle record counts differ');
  validateCards(cards);const snapshot={commit,language,cards,sets};normalize(snapshot);return snapshot;
 };
}
module.exports={createCompiledSnapshotLoader,writeBundleManifest};
