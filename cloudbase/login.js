import {login,logout} from './client.js';
const form = document.querySelector('form');
if (new URLSearchParams(location.search).has('logout')) {
  form.hidden = true;
  try { await logout(); } finally { location.replace('./admin.html'); }
}
form.addEventListener('submit',async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    await login(form.elements.username.value.trim(),form.elements.password.value);
    location.replace('./admin.html');
  } catch {
    form.querySelector('[role=alert]').textContent = '登录失败，请核对测试管理员账号、密码及网络连接。';
  } finally {
    button.disabled=false;
  }
});

form.querySelector('fieldset').disabled = false;
