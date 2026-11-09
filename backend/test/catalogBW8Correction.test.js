'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {correctBW8Definition}=require('../../ci/apply-catalog-corrections');
const source="import { Set } from '../../interfaces'\nimport serie from '../BW'\n\nconst set: Set = {\n\tid: 'BW8a',\n\tname: {\n\t\tja: 'ライデンナックル',\n\t\tko: '볼트너클'\n\t},\n\n\tserie: serie,\n\n\tcardCount: {\n\t\tofficial: 51\n\t},\n\treleaseDate: '2012-12-14'\n}\n\nexport default set\n";
test('reviewed BW8b identity is corrected before compilation without discarding either set',()=>{const result=correctBW8Definition(Buffer.from(source));assert.equal(result.record.beforeGitBlob,'fcc0f3e7ef47373c8bcedaa2f134eeeb8d99cffd');assert.equal(result.record.afterGitBlob,'8baa099613ebdf5a50904340583224e2762a4f7a');assert.equal(result.record.applied,true);assert.equal(result.bytes.toString(),source.replace("id: 'BW8a'","id: 'BW8b'"));assert.equal(correctBW8Definition(result.bytes).record.applied,false);});
test('changed upstream BW8b definitions fail closed',()=>{assert.throws(()=>correctBW8Definition(Buffer.from(source.replace('51','52'))),/Unreviewed/);});
