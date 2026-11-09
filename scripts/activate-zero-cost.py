from pathlib import Path
import hashlib
import re
EXPECTED={'backend/src/db.js':'f1151b1ede5d4249a741497f1d2f4016bf21f9a4','backend/src/routes/collection.js':'3a3ac947ee3dbb546968a7b5e7f2341b30abfeed','frontend/src/apiBase.js':'4fed92c7b6b739bf1566fafa7fec136b4453133d','frontend/src/components/CardSearch.jsx':'2ddf1707003c03bd15e520207205a3e702e9b9e0'}
MARKER='// zero-cost-confirmation-v1'
def once(text,old,new):
 if text.count(old)!=1:raise SystemExit('Reviewed integration point changed: '+old[:100])
 return text.replace(old,new,1)
def main():
 texts={name:Path(name).read_text() for name in EXPECTED}
 if all(MARKER in text for text in texts.values()):return
 for name,text in texts.items():
  raw=Path(name).read_bytes();digest=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
  if digest!=EXPECTED[name]:raise SystemExit(name+': source changed; refusing to overwrite')
 db=texts['backend/src/db.js']
 db=once(db,'  // --- MIGRATIONS ---',"  // --- MIGRATIONS ---\n  await require('./utils/zeroCost').prepare({run,get,all});")
 route=texts['backend/src/routes/collection.js']
 route="const zeroCost = require('../utils/zeroCost');\n"+route
 a=route.index('async function addCardToCollection(user, body) {');b=route.index('// 2b. Localize card to a specific language printing',a)
 block=route[a:b]
 point='  // Grading, validated here rather than at the two call sites'
 validation="  const cost = zeroCost.parsePurchaseCost(body);\n  if (!cost.ok) { const error = new AddCardError(cost.status, cost.error); error.code = cost.code; throw error; }\n\n"
 block=once(block,point,validation+point)
 if block.count('purchase_price || 0')!=2:raise SystemExit('Expected two reviewed insert cost parameters')
 block=block.replace('purchase_price || 0','cost.amount')
 if block.count('grader, grade, cert_number\n')!=2:raise SystemExit('Expected two collection insert column lists')
 block=block.replace('grader, grade, cert_number\n','grader, grade, cert_number, zero_cost_confirmed\n')
 block=once(block,') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
 block=once(block,') VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',') VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
 block,count=re.subn(r'(?m)^(\s*)grader, gradeValue, certValue$',r"\1grader, gradeValue, certValue, cost.confirmedZero && list_type === 'collection' ? 1 : 0",block)
 if count!=2:raise SystemExit('Expected two collection insert parameter lists')
 block=once(block,'const stack = stackable && !isGraded;','const stack = stackable && !isGraded && !cost.confirmedZero;')
 route=route[:a]+block+route[b:]
 route=once(route,'return res.status(error.status).json({ error: error.message });','return res.status(error.status).json({ error: error.message, code: error.code });')
 route=once(route,'  const added = [];\n  const failed = [];',"  const costCheck = zeroCost.parsePurchaseCost(shared);\n  if (!costCheck.ok) return res.status(costCheck.status).json({error:costCheck.error,code:costCheck.code});\n  const added = [];\n  const failed = [];")
 api=texts['frontend/src/apiBase.js']
 api="import { installZeroCostConfirmation } from './utils/zeroCostConfirmation.mjs';\n"+api+"\ninstallZeroCostConfirmation(window);\n"
 search=texts['frontend/src/components/CardSearch.jsx']
 old='purchase_price: parseFloat(purchasePrice) || 0'
 if search.count(old)!=3:raise SystemExit('Expected three reviewed search add-cost fields')
 search=search.replace(old,"purchase_price: purchasePrice === '' ? null : Number(purchasePrice)")
 outputs={'backend/src/db.js':db,'backend/src/routes/collection.js':route,'frontend/src/apiBase.js':api,'frontend/src/components/CardSearch.jsx':search}
 for name,text in outputs.items():Path(name).write_text(MARKER+'\n'+text)
if __name__=='__main__':main()
