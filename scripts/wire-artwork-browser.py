from pathlib import Path
import hashlib

def once(text,old,new):
    if text.count(old)!=1: raise SystemExit('Artwork integration anchor changed')
    return text.replace(old,new,1)
def guarded(name,sha,marker,transform):
    raw=Path(name).read_bytes();text=raw.decode()
    if marker in text:return text
    actual=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
    if actual!=sha:raise SystemExit(name+': source changed; refusing overwrite')
    return transform(text)
def backend(text):
    return once(text,'router.use(authenticateToken, requireAdmin);',"router.use(authenticateToken, requireAdmin);\n\n// artwork-browser-v1: jobs run after the existing administrator gate.\nrouter.use('/repair', require('./artworkRepair').createArtworkRepairRouter({\n  service: require('../utils/artworkRepairService').createArtworkRepairService({\n    connect: () => require('../utils/salesRepository').openConnection(db.dbPath),\n    art: cardArt,\n  }),\n}));")
def frontend(text):
    text=once(text,"import { artUrl, useCardArtIndex } from '../utils/cardArt';","import { artUrl, useCardArtIndex } from '../utils/cardArt';\nimport { useMissingArtwork } from '../utils/useMissingArtwork';")
    text=once(text,'  const back = cardBackFor(game ?? card?.game);',"  // artwork-browser-v1: reuse local art and repair only missing English references.\n  const hasArt = !!cardId && index.has(cardId);\n  const repair = useMissingArtwork(cardId, !provider && !hasArt);\n  const repairedUrl = repair?.state === 'available' ? repair.url : null;\n  const back = cardBackFor(game ?? card?.game);")
    text=once(text,'    cardId && index.has(cardId) ? artUrl(cardId) : null,','    hasArt ? (repairedUrl || artUrl(cardId)) : null,')
    text=once(text,'    provider || null,\n    back,','    provider || null,\n    !hasArt ? repairedUrl : null,\n    back,')
    text=once(text,"      data-card-back={isBack ? 'true' : undefined}","      data-card-back={isBack ? 'true' : undefined}\n      data-artwork-repair={hasArt ? 'available' : repair?.state}\n      title={imgProps.title ?? (!hasArt && repair?.state === 'unavailable' ? 'Artwork unavailable from configured sources.' : !hasArt && repair?.state === 'not_authorized' ? 'An administrator must repair missing artwork.' : undefined)}")
    return text
back='backend/src/routes/cardArt.js';front='frontend/src/components/CardImage.jsx';add='frontend/src/components/AddCards.jsx'
back_text=guarded(back,'9d3b1a378790b535d1783baa6d9af09fc87ad457','// artwork-browser-v1:',backend)
front_text=guarded(front,'b115fb0ec121bf71c1fe45761cc62f7ea2c821b3','// artwork-browser-v1:',frontend)
add_text=Path(add).read_text();old='Coverage varies; automatic artwork repair is not connected yet.';new='Missing English artwork can be repaired in the background for administrators. External lookups may use provider allowance; coverage varies.'
if new not in add_text:add_text=once(add_text,old,new)
for name,text in [(back,back_text),(front,front_text),(add,add_text)]:Path(name).write_bytes(text.encode())
