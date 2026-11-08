import test from 'node:test';
import assert from 'node:assert/strict';
import {cardSaleTarget,sealedSaleTarget} from './saleTargets.js';
test('card sale selects the physical entry and never substitutes a catalog identifier',()=>{assert.equal(cardSaleTarget({id:'123',name:'Catalog card'}),null);assert.equal(cardSaleTarget({id:'catalog',entry_id:7,name:'Owned',quantity:3}).id,7);assert.equal(cardSaleTarget({id:8,card_id:'catalog'}).id,8);});
test('wishlist and sold entries do not offer Sell',()=>{assert.equal(cardSaleTarget({entry_id:7,list_type:'wishlist'}),null);assert.equal(cardSaleTarget({entry_id:7,list_type:'sold'}),null);});
test('sealed Sell is tied to the exact active purchase lot',()=>{assert.equal(sealedSaleTarget({id:9,remaining_quantity:2,currency:'EUR'},{name:'Box'}).id,9);assert.equal(sealedSaleTarget({id:9,remaining_quantity:0},{}),null);assert.equal(sealedSaleTarget({id:9,remaining_quantity:2},{archived_at:'date'}),null);});
