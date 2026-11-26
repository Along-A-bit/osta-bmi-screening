// Compare the deployed SQL scorer to the public form without creating any records.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {evaluate} from '../src/screen.js';

const [cli,env] = process.argv.slice(2);
if (!cli || !env) throw Error('Usage: node cloudbase/check.mjs <cloudbase CLI js path> <environment id>');
const base = {age:70,sex:'女',menopause:'已绝经',height:200,unit:'kg',weight:70};
const changes = [
  ...[75,74.5,65.5,65,60.5,50,45.5,45].map(weight=>({weight})),
  ...[73.999,74,95.999,96,111.999,112].flatMap(weight=>[{weight},{weight:weight*2,unit:'jin'}]),
  {sex:'男'}, {menopause:'未绝经'}, {menopause:'不确定'}, {age:17}, {age:18},
  {height:160,weight:91,unit:'jin'}
];
const inputs = changes.map(change=>({...base,...change}));
const fixture = Buffer.from(JSON.stringify(inputs)).toString('base64');
const sql = `SELECT osta_trial.measure(value) AS result
  FROM jsonb_array_elements(convert_from(decode('${fixture}','base64'),'UTF8')::jsonb)
  WITH ORDINALITY AS cases(value,idx) ORDER BY idx`;
const raw = execFileSync(process.execPath,[cli,'db','execute','-e',env,'--json','--sql',sql],{encoding:'utf8'});
const rows = JSON.parse(raw).data.Rows;
assert.equal(rows.length,inputs.length);
rows.forEach((row,i)=>{
  const result = JSON.parse(JSON.parse(row)[0]);
  const expected = evaluate(inputs[i]);
  assert.ok(Math.abs(result.bmi-expected.bmi)<1e-10);
  assert.deepEqual({...result,bmi:expected.bmi},expected);
});
console.log(inputs.length+' CloudBase / browser scoring comparisons passed.');
