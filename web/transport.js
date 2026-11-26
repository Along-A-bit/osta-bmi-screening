export async function request(url,method='GET',body) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  let res;
  try{res=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:controller.signal});}
  catch{throw Error('连接未完成，请稍后重试。');}
  finally{clearTimeout(timer);}
  let data;try{data=await res.json();}catch{throw Error('连接中断，请稍后重试');}
  if(!res.ok)throw Error(data.error||'请求失败，请重试');
  return data;
}
export async function csvBlob(filters) {
  const res=await fetch('/api/admin/export.csv?'+new URLSearchParams(filters),{cache:'no-store'});
  if(!res.ok)throw Error(res.status===403?'请重新登录管理员账号':'导出失败，请重试');
  return res.blob();
}
