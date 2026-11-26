import {apiOrigin, publishKey} from './config.js';
import {toCsv} from './screen.js';

const sessionKey = 'osta.cloudbase.admin';
const rpcRoot = '/v1/rdb/rest/rpc/osta_trial_';

async function post(path, body, token) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20000);
  try {
    const headers = {'Content-Type':'application/json'};
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await fetch(apiOrigin + path, {
      method:'POST', headers, body:JSON.stringify(body), signal:abort.signal, cache:'no-store'
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw Error('请核对凭证或重新登录管理员账号');
      throw Error(data.message || '请求失败，请重试');
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}
function adminToken() {
  const token = sessionStorage.getItem(sessionKey);
  if (!token) throw Error('请登录测试管理员账号');
  return token;
}
export async function login(username,password) {
  const {access_token} = await post('/auth/v1/signin', {username,password});
  if (!access_token) throw Error('登录失败，请核对账号和密码');
  await post(rpcRoot+'admin_list', {filters:{participant:'LOGIN'}}, access_token);
  sessionStorage.setItem(sessionKey, access_token);
}
export async function logout() {
  const token = sessionStorage.getItem(sessionKey);
  sessionStorage.removeItem(sessionKey);
  if (token) await post('/auth/v1/user/signout',{},token);
}
function list(filters) {
  return post(rpcRoot+'admin_list',{filters},adminToken());
}
export async function request(path, method='GET', body) {
  const url = new URL(path,location.origin);
  if (path === '/api/screenings' || path === '/api/screenings/correct') {
    return post(rpcRoot+'write',{payload:body, action:path.endsWith('/correct')?'correct':'save'},publishKey);
  }
  if (path === '/api/admin/session') {
    await list({participant:'LOGIN'});
    return {admin:true};
  }
  if (url.pathname === '/api/admin/records' && method === 'GET') return list(Object.fromEntries(url.searchParams));
  if (url.pathname.startsWith('/api/admin/records/') && method === 'PATCH') {
    return post(rpcRoot+'admin_edit',{payload:{...body,id:url.pathname.split('/').pop()}},adminToken());
  }
  throw Error('请求地址无效');
}
export async function csvBlob(filters) {
  const all = [];
  let snapshot;
  for (;;) {
    const page = await list({...filters,snapshot,offset:all.length});
    snapshot = page.snapshot;
    all.push(...page.rows);
    if (!page.rows.length || all.length >= page.total) break;
  }
  return new Blob([toCsv(all)],{type:'text/csv;charset=utf-8'});
}
