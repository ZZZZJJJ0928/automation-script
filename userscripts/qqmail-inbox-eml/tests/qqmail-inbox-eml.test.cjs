'use strict';

const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const source = readFileSync(resolve(__dirname, '../qqmail-inbox-eml.user.js'), 'utf8');
const BUTTON = '.qqmail-inbox-eml-button';
const rowHTML = id => `<div class="mail-list-page-item" data-mailid="${id}"><div class="mail-text"><span class="mail-subject">测试邮件</span></div><div class="mail-time">今天</div></div>`;

function setup(t, { hash = '#/list/1', sid = 'test-session', html = rowHTML('test-mail-a') } = {}) {
  const dom = new JSDOM(`<!doctype html><head></head><body>${html}</body>`, {
    url: `https://wx.mail.qq.com/home/index${sid ? `?sid=${sid}` : ''}${hash}`,
    runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());
  const downloads = [];
  // 截获最终的浏览器下载操作，测试不会请求真实邮箱。
  dom.window.HTMLAnchorElement.prototype.click = function () {
    downloads.push({ url: new URL(this.href), target: this.target, rel: this.rel });
  };
  dom.window.eval(source);
  return { window: dom.window, document: dom.window.document, downloads };
}

const waitForRefresh = () => new Promise(resolve => setTimeout(resolve, 180));

test('仅给收件箱的有效邮件行添加按钮，重复执行也不重复添加', t => {
  const { window, document } = setup(t, { html: rowHTML('test-a') + rowHTML('test-b') + rowHTML('') + '<div data-mailid="unrelated">其他组件</div>' });
  assert.equal(document.querySelectorAll(BUTTON).length, 2);
  window.eval(source);
  assert.equal(document.querySelectorAll(BUTTON).length, 2);
  assert.equal(document.querySelectorAll('#qqmail-inbox-eml-style').length, 1);
  assert.equal(document.querySelector(BUTTON).getAttribute('type'), 'button');
});

test('下载对应原始 EML，编码邮件 ID，且不会打开或勾选邮件行', t => {
  const { window, document, downloads } = setup(t, { html: rowHTML('ZC_test~id&extra=1') });
  let rowEvents = 0;
  const row = document.querySelector('.mail-list-page-item');
  const button = row.querySelector(BUTTON);
  const events = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'keydown', 'keyup', 'click'];
  for (const type of events) {
    row.addEventListener(type, () => { rowEvents++; });
    button.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
  }
  assert.equal(rowEvents, 0);
  assert.equal(downloads.length, 1);
  const { url, target, rel } = downloads[0];
  assert.equal(url.origin, 'https://wx.mail.qq.com');
  assert.equal(url.pathname, '/read/readmail');
  assert.equal(url.searchParams.get('func'), '3');
  assert.equal(url.searchParams.get('mailid'), 'ZC_test~id&extra=1');
  assert.equal(url.searchParams.get('sid'), 'test-session');
  assert.equal(url.searchParams.has('extra'), false);
  assert.equal(target, '_blank');
  assert.match(rel, /noopener/);
  assert.equal(document.querySelectorAll('a').length, 0);
});

test('虚拟列表复用行、登录会话更新后使用点击时的最新值', t => {
  const { window, document, downloads } = setup(t);
  document.querySelector('.mail-list-page-item').setAttribute('data-mailid', 'test-mail-new');
  window.history.replaceState(null, '', '?sid=renewed-session#/list/1');
  document.querySelector(BUTTON).click();
  assert.equal(downloads[0].url.searchParams.get('mailid'), 'test-mail-new');
  assert.equal(downloads[0].url.searchParams.get('sid'), 'renewed-session');
});

test('滚动加载新行、重新渲染现有行后自动补齐按钮', async t => {
  const { document } = setup(t);
  document.body.insertAdjacentHTML('beforeend', rowHTML('test-mail-b'));
  document.querySelector('.mail-list-page-item').querySelector(BUTTON).remove();
  await waitForRefresh();
  assert.equal(document.querySelectorAll(BUTTON).length, 2);
  await waitForRefresh();
  assert.equal(document.querySelectorAll(BUTTON).length, 2);
});

test('退出收件箱会移除按钮，返回收件箱会恢复', async t => {
  const { window, document, downloads } = setup(t);
  window.location.hash = '#/list/3';
  // 在异步清理发生之前点击旧按钮也不应发起下载。
  document.querySelector(BUTTON).click();
  assert.equal(downloads.length, 0);
  await waitForRefresh();
  assert.equal(document.querySelectorAll(BUTTON).length, 0);
  window.location.hash = '#/list/1';
  await waitForRefresh();
  assert.equal(document.querySelectorAll(BUTTON).length, 1);
});

test('其他文件夹、详情页和相似编号的文件夹均不添加按钮', t => {
  for (const hash of ['#/list/10', '#/list/3', '#/read/test-mail', '#/list/1evil']) {
    const { document } = setup(t, { hash });
    assert.equal(document.querySelectorAll(BUTTON).length, 0, hash);
  }
});

test('缺失会话或邮件 ID 时不下载，显示可重试提示', t => {
  const { window, document, downloads } = setup(t, { sid: '' });
  const button = document.querySelector(BUTTON);
  button.click();
  assert.equal(downloads.length, 0);
  assert.equal(button.textContent, '请刷新重试');
  window.history.replaceState(null, '', '?sid=recovered-session#/list/1');
  button.click();
  assert.equal(downloads.length, 1);
  assert.equal(button.textContent, '下载 EML');
  assert.equal(button.hasAttribute('data-error'), false);
  document.querySelector('.mail-list-page-item').removeAttribute('data-mailid');
  button.click();
  assert.equal(downloads.length, 1);
});
