from pathlib import Path
import hashlib

def once(text,old,new):
 if text.count(old)!=1:raise SystemExit('Reviewed opening acquisition point changed: '+old[:100])
 return text.replace(old,new,1)
def main():
 collection=Path('backend/src/routes/collection.js')
 opening=Path('backend/src/routes/sealedOpenings.js')
 route=collection.read_text();sealed=opening.read_text()
 old_signature='async function addCardToCollection(user, body) {'
 new_signature='async function addCardToCollection(user, body, { openingPull = false } = {}) {'
 old_call="const added = await collection.addCardToCollection(user, { card_id: pull.cardId, quantity: pull.quantity, language: known?.language || 'English', purchase_price: 0, game: known?.game || 'pokemon', location_id: null });"
 new_call=old_call[:-3]+', { openingPull: true });'
 if new_signature in route and new_call in sealed:return
 if new_signature in route or new_call in sealed:raise SystemExit('Partial opening acquisition integration; refusing to rewrite')
 raw=opening.read_bytes();digest=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
 if digest!='65802a8c23866a00042c6e746fd2d448f0c5a083':raise SystemExit('Sealed opening source changed; review before modifying')
 route=once(route,old_signature,new_signature)
 route=once(route,'const cost = zeroCost.parsePurchaseCost(body);','const cost = zeroCost.parsePurchaseCost(body, { openingPull });')
 sealed=once(sealed,old_call,new_call)
 collection.write_text(route);opening.write_text(sealed)
if __name__=='__main__':main()
