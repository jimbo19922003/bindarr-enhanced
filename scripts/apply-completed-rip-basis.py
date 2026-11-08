from pathlib import Path
marker='// completed-rip-basis-v1\n'
def once(s,old,new):
 if s.count(old)!=1:raise RuntimeError('Completed rip anchor changed: '+old[:100])
 return s.replace(old,new,1)
changes=[]
p=Path('backend/src/utils/openingBasisRepository.js');s=p.read_text()
if not s.startswith(marker):changes.append((p,marker+once(s,'module.exports = { createOpeningBasisRepository };','module.exports = { createOpeningBasisRepository, schema };')))
p=Path('backend/src/utils/salesApplication.js');s=p.read_text()
if not s.startswith(marker):
 s=once(s,'SELECT id FROM sealed_pull WHERE user_id=?','SELECT * FROM sealed_pull WHERE user_id=?')
 anchor=" const basis=!pull&&typeof copy.purchase_price==='number'"
 if s.count(anchor)!=1:raise RuntimeError('Purchase basis anchor changed')
 block=""" const completed=pull?.opening_id ? await require('./completedRipBasis').forCopy(db,user,copy,pull.opening_id) : null;
 if(completed?.snapshot)return {name:copy.name,cardId:copy.card_id,source:'opening',remainingQuantity:1,remainingBasisCents:completed.basisCents,openingDraft:completed.snapshot};
"""
 s=s[:s.index(anchor)]+block+s[s.index(anchor):]
 s=once(s,"return {name:copy.name,cardId:copy.card_id,source:basis==null?'unknown':'direct',remainingQuantity:1,remainingBasisCents:basis};","return {name:copy.name,cardId:copy.card_id,source:basis==null?'unknown':'direct',remainingQuantity:1,remainingBasisCents:basis,basisReason:completed?.reason || null};")
 s=once(s,'return {...amounts,itemName:s.name,source:s.source,currency:v.currency,previewToken:token};','return {...amounts,itemName:s.name,source:s.source,currency:v.currency,previewToken:token,basisReason:s.basisReason || null,willFreezeOpening:!!s.openingDraft};')
 s=once(s,"      if(s.source==='opening')lot=await opening.createOpeningLot(db,user,v.id);","      if(s.source==='opening'){if(s.openingDraft)await require('./completedRipBasis').freeze(db,user,s.openingDraft);lot=await opening.createOpeningLot(db,user,v.id);}")
 changes.append((p,marker+s))
p=Path('frontend/src/components/SaleDialogHost.jsx');s=p.read_text()
if not s.startswith(marker):
 anchor="    {preview.realizedGainCents==null&&<label"
 addition='''    {preview.willFreezeOpening&&<small>Confirming also freezes this completed rip's cost allocation. Its acquisition details cannot be edited without a correction workflow.</small>}
    {preview.basisReason&&<small>{preview.basisReason}</small>}
'''
 s=once(s,anchor,addition+anchor)
 changes.append((p,marker+s))
for path,text in changes:path.write_text(text)
