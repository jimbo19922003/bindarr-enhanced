const providers=new Set(['carddex','pokewallet']);
export async function saveInstanceCredential(provider,value,request=(...args)=>globalThis.fetch(...args)){
 if(!providers.has(provider))throw new Error('Unsupported provider');
 const key=typeof value==='string'?value.trim():'';
 if(!key||key.length>256||/\s/.test(key))throw new Error('Enter a nonempty key containing no whitespace, at most 256 characters.');
 const endpoint='/api/settings/provider-keys/'+provider;
 const response=await request(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({key}),cache:'no-store'});
 if(!response.ok)throw new Error('Provider key save failed.');
 const saved=await response.json();
 if(saved.saved!==true||saved.savedKeyPresent!==true)throw new Error('Backend did not confirm persistence.');
 const checked=await request(endpoint,{cache:'no-store'});
 if(!checked.ok)throw new Error('Save may have succeeded, but status verification failed.');
 const status=await checked.json();
 if(status.savedKeyPresent!==true||status.keySource!=='database')throw new Error('Save may have succeeded, but database persistence could not be verified.');
 return {configured:true,savedKeyPresent:true,keySource:'database'};
}
