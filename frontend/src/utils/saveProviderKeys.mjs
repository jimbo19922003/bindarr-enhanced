export async function saveProviderKeys({isAdmin,pokewalletKey='',personal={},previous={},request=globalThis.fetch}) {
 const key=String(pokewalletKey).trim();let pokewalletSaved=false;
 const changed=Object.keys(personal).some(name=>String(personal[name]??'')!==String(previous[name]??''));
 const send=async(url,options,label)=>{let response;try{response=await request(url,options);}catch{throw new Error(label+' could not reach the backend');}if(!response.ok)throw new Error(label+` failed (HTTP ${response.status})`);try{return await response.json();}catch{throw new Error(label+' returned an unreadable response');}};
 try {
  if(key){
   if(!isAdmin)throw new Error('An administrator must save the emergency provider key');
   if(key.length>256||/\s/.test(key))throw new Error('PokéWallet key must be a single token, at most 256 characters');
   const saved=await send('/api/settings/provider-keys/pokewallet',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})},'PokéWallet key save');
   if(saved.saved!==true||saved.savedKeyPresent!==true)throw new Error('The backend did not confirm that the PokéWallet key was saved');
   pokewalletSaved=true;
   const verified=await send('/api/settings/provider-keys/pokewallet',{cache:'no-store'},'PokéWallet key read-back');
   if(verified.savedKeyPresent!==true||verified.keySource!=='database')throw new Error('PokéWallet key read-back did not confirm database persistence');
  }
  let user=null;
  if(changed){const result=await send('/api/auth/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(personal)},'Personal API key save');user=result.user||null;}
  return {pokewalletSaved,personalSaved:changed,user};
 }catch(error){const message=pokewalletSaved?'PokéWallet key was saved, but a later verification or personal-settings step failed. '+error.message:error.message;throw Object.assign(new Error(message),{pokewalletSaved});}
}
