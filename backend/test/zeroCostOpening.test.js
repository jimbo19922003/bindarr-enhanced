'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parsePurchaseCost}=require('../src/utils/zeroCost');
test('trusted opening pulls do not create a separate gift basis',()=>{assert.deepEqual(parsePurchaseCost({purchase_price:0},{openingPull:true}),{ok:true,amount:null,confirmedZero:false});assert.deepEqual(parsePurchaseCost({purchase_price:0,zero_cost_confirmed:true},{openingPull:true}),{ok:true,amount:null,confirmedZero:false});});
test('public request fields cannot spoof the internal opening context',()=>{for(const fields of [{openingPull:true},{opening_pull:true},{acquisition_source:'opening'},{context:{openingPull:true}}])assert.equal(parsePurchaseCost({purchase_price:0,...fields}).code,'ZERO_COST_CONFIRMATION_REQUIRED');assert.equal(parsePurchaseCost({purchase_price:0,zero_cost_confirmed:true}).confirmedZero,true);});
