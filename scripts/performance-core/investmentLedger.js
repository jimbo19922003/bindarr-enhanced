'use strict';
const schema = require('../../../shared/investmentLedgerSchema.json');
const installations = new WeakMap();
function install(db) {
  if (installations.has(db)) return installations.get(db);
  const apply = async () => {
    for (const statement of [...schema.schema, schema.dailySchema, ...schema.seed]) await db.run(statement);
  };
  const work = (typeof db.withTransaction === 'function' ? db.withTransaction(apply) : apply()).catch(error => { installations.delete(db); throw error; });
  installations.set(db, work);
  return work;
}
module.exports = { install };
