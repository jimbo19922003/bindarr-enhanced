'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {LANGUAGES}=require('./languages');
const {createCompiledSnapshotLoader}=require('./pokemonCatalogBundle');
const fail=code=>Object.assign(new Error('The catalogue download source is unavailable; existing installed data is unchanged.'),{code});
const supported=new Set(LANGUAGES.map(row=>row.code));
function parseManifest(bytes,tag){
 const match=/^pokemon-catalog-([a-f0-9]{40})-\d+-\d+$/.exec(tag||'');
 const value=JSON.parse(Buffer.from(bytes).toString('utf8'));
 if(!match||value.schemaVersion!==1||value.source!=='tcgdex/cards-database'||value.commit!==match[1]||!value.languages||Array.isArray(value.languages))throw fail('CATALOG_MANIFEST_INVALID');
 const descriptor=(item,max)=>item&&/^[a-f0-9]{64}$/.test(item.sha256||'')&&Number.isSafeInteger(item.bytes)&&item.bytes>0&&item.bytes<=max;
 if(!descriptor(value.license,65536))throw fail('CATALOG_MANIFEST_INVALID');
 const codes=Object.keys(value.languages);
 if(!codes.length||codes.length>supported.size)throw fail('CATALOG_MANIFEST_INVALID');
 for(const code of codes){const entry=value.languages[code];if(!supported.has(code)||!descriptor(entry.cards,134217728)||!descriptor(entry.sets,33554432)||!Number.isSafeInteger(entry.cards.count)||entry.cards.count<1||entry.cards.count>500000||!Number.isSafeInteger(entry.sets.count)||entry.sets.count<1||entry.sets.count>10000)throw fail('CATALOG_MANIFEST_INVALID');}
 return value;
}
function createRepositoryCatalogueSource({repository=process.env.POKEMON_CATALOG_RELEASE_REPOSITORY||'jimbo19922003/bindarr-enhanced',token=process.env.TCGDEX_GITHUB_TOKEN,http=require('axios'),now=Date.now}={}){
 let cached=null,expires=0,paused=0;
 const prefix='https://api.github.com/repos/'+repository+'/';
 function allowed(url,binary){const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(u.hostname==='api.github.com'&&url.startsWith(prefix)||binary&&['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname));}
 async function get(initial,max,binary=false){
  if(now()<paused)throw fail('CATALOG_SOURCE_COOLDOWN');
  let url=initial;
  for(let redirect=0;redirect<4;redirect++){
   if(!allowed(url,binary))throw fail('CATALOG_REDIRECT_BLOCKED');
   const api=new URL(url).hostname==='api.github.com';
   let response;try{response=await http.get(url,{headers:{'User-Agent':'Bindarr-catalogue-setup',Accept:binary?'application/octet-stream':'application/vnd.github+json',...(api&&token?{Authorization:'Bearer '+token}:{})},timeout:20000,maxRedirects:0,maxContentLength:max,responseType:binary?'arraybuffer':'json',validateStatus:()=>true});}catch{throw fail('CATALOG_SOURCE_UNAVAILABLE');}
   if([403,429].includes(response.status)){const seconds=Number(response.headers?.['retry-after']);paused=now()+(Number.isFinite(seconds)&&seconds>0?Math.min(seconds*1000,86400000):900000);throw fail('CATALOG_SOURCE_COOLDOWN');}
   if([301,302,303,307,308].includes(response.status)&&binary&&response.headers?.location){url=new URL(response.headers.location,url).toString();continue;}
   if(response.status!==200)throw fail('CATALOG_SOURCE_UNAVAILABLE');
   if(binary){const bytes=Buffer.from(response.data);if(!bytes.length||bytes.length>max)throw fail('CATALOG_DOWNLOAD_TOO_LARGE');return bytes;}
   if(Buffer.byteLength(JSON.stringify(response.data))>max)throw fail('CATALOG_DOWNLOAD_TOO_LARGE');return response.data;
  }
  throw fail('CATALOG_REDIRECT_BLOCKED');
 }
 async function asset(info,name,max){const item=info.assets.find(row=>row.name===name);if(!item||!Number.isSafeInteger(item.id)||item.id<1||!Number.isSafeInteger(item.size)||item.size<1||item.size>max)throw fail('CATALOG_ASSET_MISSING');return get(prefix+'releases/assets/'+item.id,max,true);}
 return {
  async discover(){
   if(cached&&now()<expires)return cached;
   if(!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(repository))throw fail('CATALOG_SOURCE_INVALID');
   try{const releases=await get(prefix+'releases?per_page=20',2097152);if(!Array.isArray(releases))throw fail('CATALOG_SOURCE_INVALID');const release=releases.find(row=>!row.draft&&/^pokemon-catalog-[a-f0-9]{40}-\d+-\d+$/.test(row.tag_name||''));if(!release||!Array.isArray(release.assets))throw fail('CATALOG_RELEASE_MISSING');const info={tag:release.tag_name,assets:release.assets};const bytes=await asset(info,'manifest.json',1048576),manifest=parseManifest(bytes,info.tag);const names=new Set(info.assets.map(row=>row.name));if(!names.has('LICENSE')||Object.keys(manifest.languages).some(code=>!names.has(code+'.cards.json')||!names.has(code+'.sets.json')))throw fail('CATALOG_ASSET_MISSING');cached={...info,commit:manifest.commit,languages:Object.keys(manifest.languages),manifest,bytes,publishedAt:release.published_at||null};expires=now()+900000;return cached;}catch(error){paused=Math.max(paused,now()+60000);throw fail(error.code&&error.code.startsWith('CATALOG_')?error.code:'CATALOG_SOURCE_UNAVAILABLE');}
  },
  async load(info,language){
   if(!supported.has(language)||!info.languages.includes(language))throw fail('CATALOG_LANGUAGE_UNAVAILABLE');
   const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bindarr-catalog-'));
   try{await fs.writeFile(path.join(directory,'manifest.json'),info.bytes,{flag:'wx',mode:0o600});await fs.writeFile(path.join(directory,'LICENSE'),await asset(info,'LICENSE',65536),{flag:'wx',mode:0o600});await fs.mkdir(path.join(directory,language),{mode:0o700});for(const kind of ['cards','sets'])await fs.writeFile(path.join(directory,language,kind+'.json'),await asset(info,language+'.'+kind+'.json',info.manifest.languages[language][kind].bytes),{flag:'wx',mode:0o600});return await createCompiledSnapshotLoader({directory})({commit:info.commit,language});}finally{await fs.rm(directory,{recursive:true,force:true});}
  }
 };
}
module.exports={createRepositoryCatalogueSource,parseManifest};
