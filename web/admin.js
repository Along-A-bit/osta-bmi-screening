import {risks,followStates,formatBmi,evaluate} from './screen.js';
import {request,mount,when} from './base.js';
const empty=()=>({participant:'',from:'',to:'',risk:'',follow:'',latest:''});
mount(Vue.createApp({
  data:()=>({allowed:false,loading:true,busy:false,error:'',filters:empty(),active:empty(),offset:0,rows:[],total:0,groups:[],acceptance:false,record:null,entry:{},follow:'',editorMessage:'',risks,followStates,seq:0}),
  async mounted(){try{await request('/api/admin/session');this.allowed=true;await this.load(true);}catch(e){this.error=e.message;}finally{this.loading=false;}},
  methods:{when,formatBmi,
    url(offset){return '/api/admin/records?'+new URLSearchParams({...this.active,offset});},
    async load(reset=false){
      if(reset){this.offset=0;this.active={...this.filters};this.record=null;}
      const seq=++this.seq;this.busy=true;this.error='';
      try{const data=await request(this.url(this.offset));if(seq===this.seq){this.rows=data.rows;this.total=data.total;this.groups=data.groups;this.acceptance=data.acceptance;}}
      catch(e){if(seq===this.seq){this.error=e.message;this.rows=[];this.total=0;this.groups=[];this.acceptance=false;}}
      finally{if(seq===this.seq)this.busy=false;}
    },
    page(delta){this.offset+=delta;this.load();},clear(){this.filters=empty();this.load(true);},
    pendingRisk(){this.filters={...empty(),latest:'1',risk:'高风险',follow:'待跟进'};this.load(true);},
    history(id){this.filters={...empty(),participant:id};this.load(true);},
    edit(r){this.record={...r};this.entry={...r};this.follow=r.follow;this.editorMessage='';this.$nextTick(()=>document.querySelector('#editor')?.scrollIntoView({block:'start'}));},
    async change(action){
      const original=this.record;
      try{if(action==='correct')evaluate(this.entry);
        await request('/api/admin/records/'+original.id,'PATCH',{...this.entry,follow:this.follow,action,version:original.version});
        await this.load();const fresh=this.rows.find(x=>x.id===original.id);
        if(fresh){this.edit(fresh);this.editorMessage='修改已保存';}else this.record=null;
      }catch(e){this.editorMessage=e.message;}
    },
    async download(){
      this.busy=true;this.error='';
      try{
        const res=await fetch('/api/admin/export.csv?'+new URLSearchParams(this.active),{cache:'no-store'});
        if(!res.ok)throw Error(res.status===403?'请重新登录管理员账号':'导出失败，请重试');
        const url=URL.createObjectURL(await res.blob());
        const link=document.createElement('a');
        link.href=url;link.download=this.acceptance?'上线验收记录.csv':'筛查记录.csv';link.click();
        setTimeout(()=>URL.revokeObjectURL(url),30000);
      }catch(e){this.error=e.message;}
      finally{this.busy=false;}
    }
  }
}));
