import {evaluate,freshAccess,formatBmi,advice} from './screen.js';
import {blank,request,mount} from './base.js';
const storage='osta.pending.v1';
function remember(value){try{if(value)sessionStorage.setItem(storage,JSON.stringify(value));else sessionStorage.removeItem(storage);}catch{}}
mount(Vue.createApp({
  data:()=>({entry:blank(),mode:'new',access:{participant:'',proof:''},result:null,pending:null,editing:false,version:1,error:'',status:'',copyMessage:'',advice}),
  mounted(){
    try{const saved=JSON.parse(sessionStorage.getItem(storage));if(saved){this.result=evaluate(saved);this.pending=saved;this.status='fail';this.error='上一次保存状态待确认，请重试。';}}catch{remember(null);}
  },
  methods:{formatBmi,
    async submit(){
      if(this.editing){await this.correct();return;}
      if(this.pending)return;
      this.error='';
      try{
        const result=evaluate(this.entry);
        const access=this.mode==='new'?freshAccess():{participant:this.access.participant.trim().toUpperCase(),proof:this.access.proof.trim().toLowerCase()};
        if(!/^P[A-F0-9]{16}$/.test(access.participant)||!/^([a-f0-9]{32})$/.test(access.proof))throw Error('请核对参与者编号和32位复测凭证');
        this.pending={...this.entry,...access,mode:this.mode,requestId:crypto.randomUUID()};
        remember(this.pending);this.result=result;
        this.$nextTick(()=>document.querySelector('#result-title')?.focus());
        await this.persist();
      }catch(e){this.error=e.message;}
    },
    async persist(){
      if(this.status==='busy'||this.status==='ok')return;
      this.status='busy';this.error='';
      try{await request('/api/screenings','POST',this.pending);this.status='ok';remember(null);}
      catch(e){this.status='fail';this.error='结果已保留。'+e.message;}
    },
    editCurrent(){
      this.entry={...this.pending};this.editing=true;this.error='';this.result=null;
    },
    async correct(){
      if(this.status==='busy')return;
      this.error='';
      try {
        const result=evaluate(this.entry);
        this.status='busy';
        const payload={...this.pending,...this.entry,version:this.version};
        await request('/api/screenings/correct','POST',payload);
        this.version++;this.pending=payload;this.result=result;this.editing=false;
      }catch(e){this.error=e.message;}
      finally{this.status='ok';}
    },
    async copyAccess(){try{await navigator.clipboard.writeText('参与者编号 '+this.pending.participant+'\n复测凭证 '+this.pending.proof);this.copyMessage='已复制';}catch{this.copyMessage='请展开凭证后长按复制';}},
    restart(){
      if(this.status==='fail'){
        if(!confirm('返回后本次待保存记录将被放弃。继续吗？'))return;
        this.entry={...this.pending};this.mode=this.pending.mode;this.access={participant:this.pending.participant,proof:this.pending.proof};
      }else{this.entry=blank();this.mode='new';this.access={participant:'',proof:''};}
      remember(null);this.pending=null;this.editing=false;this.version=1;this.result=null;this.status='';this.error='';this.copyMessage='';window.scrollTo(0,0);
    }
  }
}));
