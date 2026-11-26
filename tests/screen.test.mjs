import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,formatBmi} from '../src/screen.js';

const base={age:70,sex:'女',menopause:'已绝经',height:200,unit:'kg',weight:70};
for (const [weight,index,risk] of [[74.5,0.9,'低风险'],[65.5,-0.9,'低风险'],[65,-1,'中风险'],[60.5,-1.9,'中风险'],[50,-4,'中风险'],[45.5,-4.9,'高风险'],[45,-5,'高风险']]) {
  test('OSTA '+weight+' kg → '+index+' '+risk,()=>{
    const result=evaluate({...base,weight});
    assert.equal(result.osta,index);assert.equal(result.risk,risk);
  });
}
for (const [weight,category] of [[73.999,'体重过低'],[74,'体重正常'],[95.999,'体重正常'],[96,'超重'],[111.999,'超重'],[112,'肥胖']]) {
  test('BMI 未修约阈值 '+weight+' kg',()=>{
    const result=evaluate({...base,weight});
    assert.equal(result.category,category);
    const displayed=Number(formatBmi(result.bmi));
    for(const limit of [18.5,24,28])assert.equal(displayed<limit,result.bmi<limit);
    assert.deepEqual(evaluate({...base,weight:weight*2,unit:'jin'}).category,category);
  });
}
for (const [input,reason] of [[{sex:'男'},'男性'],[{menopause:'未绝经'},'未绝经'],[{menopause:'不确定'},'未确定'],[{age:17},'未满18']]) {
  test('OSTA 不适用：'+reason,()=>{
    const r=evaluate({...base,...input});assert.equal(r.osta,null);assert.equal(r.risk,input.menopause==='不确定'?'暂未评估':'不适用');
    assert.ok(r.reason.includes(reason));assert.equal(r.category,input.age===17?'未成年人不分级':'体重过低');
  });
}
test('周岁、必填项、单位和刚满18岁',()=>{
  assert.equal(evaluate({...base,age:18,sex:'男'}).category,'体重过低');
  for(const invalid of [{age:17.5},{height:0},{weight:''},{unit:'lb'},{menopause:''},{age:null},{weight:'Infinity'}])assert.throws(()=>evaluate({...base,...invalid}));
  const a=evaluate({...base,unit:'jin',weight:90.5});
  assert.equal(a.kg,45.25);
  assert.equal(a.osta,evaluate({...base,weight:45.25}).osta);
});
