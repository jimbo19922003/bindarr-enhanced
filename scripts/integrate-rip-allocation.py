from pathlib import Path
import hashlib
MARKER='// rip-unit-allocation-v1'
EXPECTED={'backend/src/utils/completedRipBasis.js':'f15297e504470cfe5ba9dd91f01031e7703d5bf2','backend/src/utils/openingBasisRepository.js':'789532e76389820bde11e7896a55f6e8f05a904d','backend/src/routes/openingEdit.js':'557bb038f3ba768227ce032f2340c13621a7b1ef','backend/src/routes/sealedOpenings.js':'f05106b715be6c91aff3427d758540b59cd711c9','frontend/src/components/CardInspectorModal.jsx':'2fd1567123259a3fd2a3c3b3fab2459f3b791b4c','frontend/src/components/RipForm.jsx':'c03b099257f3f6640eb6caf914a1828ae77c87c7'}
def once(text,old,new):
 if text.count(old)!=1:raise SystemExit('Reviewed integration point changed: '+old[:100])
 return text.replace(old,new,1)
def main():
 texts={name:Path(name).read_text() for name in EXPECTED}
 if all(MARKER in text for text in texts.values()):return
 for name,expected in EXPECTED.items():
  raw=Path(name).read_bytes()
  if hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()!=expected:raise SystemExit(name+': source changed; refusing to overwrite')
 for name,call in [('backend/src/utils/completedRipBasis.js',"db.all('SELECT * FROM sealed_pull WHERE opening_id=? AND user_id=? ORDER BY id',[openingId,user])"),('backend/src/utils/openingBasisRepository.js',"db.all('SELECT * FROM sealed_pull WHERE opening_id=? AND user_id=? ORDER BY id', [openingId, userId])")]:
  text=texts[name]
  text="const {openingLineValue}=require('./openingWeights');\n"+text
  text=once(text,'const pulls = await '+call+';' if name.endswith('openingBasisRepository.js') else 'const pulls=await '+call+';', 'const pulls=(await '+call+').map(row=>({...row,opened_line_cents:openingLineValue(row)}));')
  texts[name]=text
 name='backend/src/routes/openingEdit.js';text=texts[name]
 text="const {resizeOpeningLine}=require('../utils/openingWeights');\n"+text
 text=once(text,'current_line_cents = ?, collection_id = ?, filed_ids = ?, updated_at', 'current_line_cents = ?, opened_line_cents = ?, collection_id = ?, filed_ids = ?, updated_at')
 text=once(text,'pull.currentUnit, pull.currentLine, collectionId, filed.join(\',\'), row.id, userId]', 'pull.currentUnit, pull.currentLine, resizeOpeningLine(row,pull.quantity), collectionId, filed.join(\',\'), row.id, userId]')
 texts[name]=text
 name='backend/src/routes/sealedOpenings.js';texts[name]=once(texts[name],"router.use(require('./openingEdit'));","router.use(require('./openingBasisStatus'));\nrouter.use(require('./openingEdit'));")
 name='frontend/src/components/CardInspectorModal.jsx';text=texts[name]
 text="import OpeningBasisPanel from './OpeningBasisPanel';\n"+text
 text=once(text,"          {mode === 'view' && saleTarget &&","          {mode === 'view' && <OpeningBasisPanel entryId={targetEntryId} />}\n          {mode === 'view' && saleTarget &&")
 texts[name]=text
 name='frontend/src/components/RipForm.jsx';text=texts[name]
 text="import OpeningBasisPanel from './OpeningBasisPanel';\n"+text
 text=once(text,'    <fieldset disabled={busy}', '    {editing && <OpeningBasisPanel openingId={existingOpening.id} />}\n    <p>Saving recalculates allocated opening costs from the saved opening-time values and revised quantities. The original opening cost is unchanged. Missing values remain pending; allocations frozen by a sale require a correction workflow.</p>\n    <fieldset disabled={busy}')
 texts[name]=text
 for name,text in texts.items():Path(name).write_text(MARKER+'\n'+text)
if __name__=='__main__':main()
