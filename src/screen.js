export const followStates = ['待跟进', '已沟通', '已完成骨密度检查'];
export const risks = ['低风险','中风险','高风险','不适用','暂未评估'];
export const advice = {
  '低风险':'保持规律活动。如曾因轻微跌倒发生骨折，请向医生咨询。',
  '中风险':'建议向医生咨询是否需要进行骨密度检查。',
  '高风险':'请尽早就医，和医生讨论骨密度检查及后续评估。'
};
function number(value, name, min, max, whole = false) {
  const raw = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,3})?$/.test(raw)) throw Error('请正确填写' + name + '（最多三位小数）');
  const n = Number(raw);
  if (n < min || n > max || (whole && !Number.isInteger(n))) throw Error('请核对' + name);
  return n;
}
export function evaluate(data) {
  const age = number(data.age,'年龄（周岁）',0,130,true);
  const height = number(data.height,'身高（厘米）',20,300);
  if (!['男','女'].includes(data.sex)) throw Error('请选择性别');
  if (!['kg','jin'].includes(data.unit)) throw Error('请选择体重单位');
  const weight = number(data.weight,'体重',0.1,data.unit === 'jin' ? 1500 : 750);
  const kg = data.unit === 'jin' ? weight / 2 : weight;
  const sex = data.sex;
  const menopause = sex === '女' ? data.menopause : null;
  if (sex === '女' && !['已绝经','未绝经','不确定'].includes(menopause)) throw Error('请选择绝经状态');
  const reason = age < 18 ? '未满18周岁，本工具不评估儿童和青少年骨质疏松风险。' :
    sex === '男' ? '本项目的 OSTA 筛查仅用于亚洲绝经后女性，男性请咨询医生选择评估方式。' :
    menopause === '未绝经' ? '本工具适用于绝经后女性，你填写的状态为未绝经。' :
    menopause === '不确定' ? '绝经状态尚未确定，本次不进行 OSTA 分层。' : '';
  // The OSTA research group truncates the final score toward zero (P58, HKMJ 2001).
  const osta = reason ? null : (Math.trunc((kg - age) / 5) || 0);
  const risk = reason ? (age>=18 && menopause==='不确定' ? '暂未评估' : '不适用') : osta < -4 ? '高风险' : osta <= -1 ? '中风险' : '低风险';
  const bmi = kg*10000/(height*height);
  // Integer products keep exact decimal measurements on the correct side of each boundary.
  const h = BigInt(Math.round(height*1000));
  const w = BigInt(Math.round(weight*1000));
  const scale = data.unit === 'jin' ? 2n : 1n;
  const below = tenths => w*100000000n < BigInt(tenths)*scale*h*h;
  const category = age<18 ? '未成年人不分级' : below(185) ? '体重过低' : below(240) ? '体重正常' : below(280) ? '超重' : '肥胖';
  return {age,sex,menopause,height,weight,unit:data.unit,kg,osta,risk,reason,bmi,category};
}
export function formatBmi(value) {
  for(let places=1;places<=8;places++) {
    const s=value.toFixed(places);
    if (![18.5,24,28].some(b=>Number(s)===b && value<b-1e-12)) return s;
  }
  return String(value);
}
export function freshAccess() {
  const token = crypto.randomUUID().replaceAll('-','');
  return {participant:'P'+crypto.randomUUID().replaceAll('-','').slice(0,16).toUpperCase(), proof:token};
}
export const csvFields = {
  participant:'参与者编号',created:'筛查时间（UTC）',updated:'更新时间（UTC）',age:'年龄（周岁）',sex:'性别',
  menopause:'绝经状态',height:'身高（厘米）',weight:'原始体重',unit:'体重单位',kg:'体重（公斤）',
  osta:'OSTA指数',risk:'OSTA筛查风险',reason:'不适用原因',bmi:'BMI（kg/m²）',category:'BMI分类',follow:'跟进状态'
};
export function toCsv(rows) {
  const quote = value => '"'+String(value??'').replaceAll('"','""')+'"';
  return '\uFEFF'+[Object.values(csvFields),...rows.map(row=>Object.keys(csvFields).map(k=>k==='unit'?(row[k]==='jin'?'斤':'公斤'):row[k]))].map(line=>line.map(quote).join(',')).join('\r\n');
}
