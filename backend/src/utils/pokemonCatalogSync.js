'use strict';
const {LANGUAGES}=require('./languages');
const SHA=/^[a-f0-9]{40}$/;
function cooldown(error,now,fallback){const h=error.response?.headers||{};let until=now+fallback;const retry=h['retry-after'];if(retry){const n=Number(retry),date=Number.isFinite(n)?now+n*1000:Date.parse(retry);if(Number.isFinite(date))until=Math.max(until,date);}const reset=Number(h['x-ratelimit-reset']);if(Number.isFinite(reset)&&reset>0)until=Math.max(until,reset*1000);return until;}
function createGithubCommitReader({get,token=process.env.TCGDEX_GITHUB_TOKEN}={}){
 let etag=null,commit=null;
 const read=get||((url,options)=>require('axios').get(url,options));
 return {async read(){const headers={'User-Agent':'Bindarr local catalog sync',Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};if(etag)headers['If-None-Match']=etag;if(token)headers.Authorization=`Bearer ${token}`;
  const response=await read('https://api.github.com/repos/tcgdex/cards-database/commits/master',{headers,timeout:15000,maxRedirects:0,maxContentLength:2000000,validateStatus:s=>s===200||s===304});
  if(response.status===304){if(!commit)throw Object.assign(new Error('Commit cache is missing'),{code:'CATALOG_COMMIT_CACHE_MISSING'});return commit;}
  if(response.status!==200||!SHA.test(response.data?.sha||''))throw Object.assign(new Error('Unexpected upstream commit response'),{code:'CATALOG_COMMIT_INVALID'});commit=response.data.sha;etag=response.headers?.etag||null;return commit;
 }};
}
function createPokemonCatalogSync({store,loadSnapshot,reader=createGithubCommitReader(),languages=['en'],now=Date.now,intervalMs=6*60*60*1000,retryMs=15*60*1000,schedule=setInterval,unschedule=clearInterval}){
 if(!store||typeof store.status!=='function'||typeof store.importSnapshot!=='function'||typeof loadSnapshot!=='function')throw new TypeError('Store and pinned repository snapshot loader are required');
 const allowed=new Set(LANGUAGES.map(l=>l.code));if(!Array.isArray(languages)||!languages.length||new Set(languages).size!==languages.length||languages.some(l=>!allowed.has(l)))throw new TypeError('Invalid sync language list');
 if(!Number.isSafeInteger(intervalMs)||intervalMs<60000||!Number.isSafeInteger(retryMs)||retryMs<1000)throw new TypeError('Invalid sync interval');
 let inflight=null,timer=null,nextAllowedAt=0;
 let state={running:false,lastCheckedAt:null,lastFinishedAt:null,upstreamCommit:null,languages:{}};
 const status=()=>JSON.parse(JSON.stringify({...state,nextAllowedAt}));
 const failed=(error,language)=>{nextAllowedAt=Math.max(nextAllowedAt,cooldown(error,now(),retryMs));const item={state:'failed',code:error.code||'CATALOG_SYNC_FAILED',message:'Sync failed; the last successfully imported catalog remains available.'};if(language)state.languages[language]=item;else state.error=item;};
 async function run(){
  state={...state,running:true,lastCheckedAt:new Date(now()).toISOString(),error:null,languages:{}};
  try{const commit=await reader.read();if(!SHA.test(commit||''))throw Object.assign(new Error('Invalid commit'),{code:'CATALOG_COMMIT_INVALID'});state.upstreamCommit=commit;
   for(const language of languages){
    try{const previous=await store.status(language);if(previous?.source_commit===commit){state.languages[language]={state:'unchanged',commit};continue;}state.languages[language]={state:'importing',commit};const snapshot=await loadSnapshot({commit,language});if(snapshot?.commit!==commit||snapshot?.language!==language)throw Object.assign(new Error('Snapshot provenance differs'),{code:'CATALOG_PROVENANCE_MISMATCH'});const result=await store.importSnapshot(snapshot);state.languages[language]={state:'updated',commit,cardCount:result.card_count,setCount:result.set_count,scanRefreshRequired:!!result.scan_refresh_required};
    }catch(error){failed(error,language);if([403,429].includes(error.response?.status))break;}
   }
  }catch(error){failed(error);}finally{state.running=false;state.lastFinishedAt=new Date(now()).toISOString();}
  return status();
 }
 function sync(){if(inflight)return inflight;if(now()<nextAllowedAt)return Promise.resolve({...status(),deferred:true});inflight=run().finally(()=>{inflight=null;});return inflight;}
 return {sync,status,start(){if(timer!==null)return;timer=schedule(()=>{void sync();},intervalMs);timer?.unref?.();},stop(){if(timer!==null){unschedule(timer);timer=null;}}};
}
module.exports={createGithubCommitReader,createPokemonCatalogSync,cooldown};
