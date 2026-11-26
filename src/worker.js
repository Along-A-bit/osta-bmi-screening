export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if(path.startsWith('/api/'))return api(request,env);
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
    const key=path==='/'?'/index.html':path==='/admin'||path==='/admin/'?'/admin.html':path;
    if(!Object.hasOwn(assets,key))return new Response('未找到页面',{status:404});
    const mime=key.endsWith('.css')?'text/css':key.endsWith('.js')?'text/javascript':key.endsWith('.txt')?'text/plain':'text/html';
    return new Response(request.method==='HEAD'?null:assets[key],{headers:{
      'Content-Type':mime+'; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    }});
  }
};
