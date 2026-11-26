export {request,csvBlob} from './transport.js';
export const blank=()=>({age:'',sex:'',height:'',weight:'',unit:'kg',menopause:''});
export const fields={
  props:['entry'],
  template:`<div class="fields">
  <div class="pair"><label>年龄 <span>（周岁）</span><div class="input"><input aria-label="年龄" required inputmode="numeric" type="text" v-model="entry.age" placeholder="请输入"><span>岁</span></div></label>
  <fieldset><legend>性别</legend><div class="choices"><label v-for="s in ['女','男']" :class="{selected:entry.sex===s}"><input type="radio" name="sex" v-model="entry.sex" :value="s" required>{{s}}</label></div></fieldset></div>
  <fieldset v-if="entry.sex==='女'"><legend>是否已绝经</legend><div class="choices"><label v-for="m in ['已绝经','未绝经','不确定']" :class="{selected:entry.menopause===m}"><input type="radio" name="menopause" v-model="entry.menopause" :value="m" required>{{m}}</label></div></fieldset>
  <label>身高<div class="input"><input aria-label="身高" required type="text" inputmode="decimal" v-model="entry.height" placeholder="请输入身高"><span>厘米</span></div></label>
  <label>体重<div class="input"><input aria-label="体重" required type="text" inputmode="decimal" v-model="entry.weight" placeholder="请输入体重"><select aria-label="体重单位" v-model="entry.unit"><option value="kg">公斤</option><option value="jin">斤</option></select></div></label>
  <p v-if="entry.unit==='jin' && Number(entry.weight)>0">相当于 {{ Number(entry.weight)/2 }} 公斤</p>
  </div>`
};
export function mount(app) {
  app.component('measurement-fields',fields);
  app.use(vant.Button);app.use(vant.Tag);app.mount('#app');
}
export const when=s=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short',hour12:false}).format(new Date(s));
