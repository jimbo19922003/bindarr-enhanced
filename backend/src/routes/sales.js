// sale-adjustments-v1
// contextual-sales-v1
'use strict';
function createRouter({service}) {
 const router=require('express').Router();
 router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!req.user||!Number.isSafeInteger(req.user.id))return res.status(401).json({error:'Authentication required'});next();});
 const handle=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(error){const status=error.status||(error instanceof TypeError||error instanceof RangeError?400:String(error.message).includes('protect')||String(error.message).includes('correction')?409:500);if(status===500)console.error('Sales request failed:',error.code||error.message);res.status(status).json({error:status===500?'Sale request failed; no partial inventory changes were committed':error.message});}};
 router.get('/:historyId/adjustments',handle(req=>service.saleAudit(req.user.id,Number(req.params.historyId))));
 router.post('/:historyId/adjustments/preview',handle(req=>service.adjustmentPreview(req.user.id,Number(req.params.historyId),req.body||{})));
 router.post('/:historyId/adjustments',handle(req=>service.adjustSale(req.user.id,Number(req.params.historyId),req.body||{})));
 router.get('/items',handle(req=>service.items(req.user.id,req.query)));
 router.post('/preview',handle(req=>service.preview(req.user.id,req.body||{})));
 router.post('/',handle(req=>service.sell(req.user.id,req.body||{})));
 router.get('/history',handle(req=>service.history(req.user.id,req.query)));
 return router;
}
module.exports={createRouter};
