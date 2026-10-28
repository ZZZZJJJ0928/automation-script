// ==UserScript==
// @name         QQ邮箱收件箱 EML 下载按钮
// @namespace    local.qqmail.inbox-eml
// @version      1.0.0
// @description  在新版 QQ 邮箱收件箱每封邮件旁添加下载 EML 按钮，使用邮箱官方原始邮件导出入口。
// @match        https://wx.mail.qq.com/home/*
// @run-at       document-idle
// @grant        none
// @noframes
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const STYLE_ID = 'qqmail-inbox-eml-style';
  const BUTTON_CLASS = 'qqmail-inbox-eml-button';
  const ROW_SELECTOR = '.mail-list-page-item[data-mailid]';

  // 防止重复执行时创建多份观察器和按钮。
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${BUTTON_CLASS} {
      display: inline-flex !important;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto !important;
      align-self: center;
      box-sizing: border-box;
      min-width: 76px;
      height: 26px;
      margin: 0 0 0 10px;
      padding: 0 9px;
      border: 1px solid #b6ccef;
      border-radius: 5px;
      background: #f6f9ff;
      color: #2468c5;
      font: 12px/1.2 system-ui, -apple-system, "Microsoft YaHei", sans-serif;
      white-space: nowrap;
      cursor: pointer;
    }
    .${BUTTON_CLASS}:hover { background: #e7f0ff; border-color: #78a6ea; }
    .${BUTTON_CLASS}:focus-visible { outline: 2px solid #397ce0; outline-offset: 2px; }
    .${BUTTON_CLASS}:active { background: #d8e8ff; }
    .${BUTTON_CLASS}[data-error] { color: #b42318; border-color: #e6a39d; }
  `;
  (document.head || document.documentElement).appendChild(style);

  function isInbox() {
    // 新版邮箱的收件箱文件夹编号为 1；其他文件夹和邮件详情不加按钮。
    return /^#\/list\/1(?:[/?]|$)/.test(location.hash);
  }

  function stopRowEvent(event) {
    event.stopPropagation();
  }

  function download(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const row = button.closest(ROW_SELECTOR);
    // 点击时重新读取，避免虚拟列表复用 DOM 后下载到之前的邮件。
    const mailId = row?.getAttribute('data-mailid')?.trim();
    // 会话由 QQ 邮箱自行更新；不保存 SID，也不需要填写密码或授权码。
    const sid = new URL(location.href).searchParams.get('sid');

    if (!isInbox() || !mailId || !sid) {
      button.textContent = '请刷新重试';
      button.dataset.error = 'true';
      button.title = '未找到当前邮件或登录会话，请刷新 QQ 邮箱后重试。';
      return;
    }

    delete button.dataset.error;
    button.textContent = '下载 EML';
    button.title = '下载这封邮件的原始 EML 文件（含邮件内的普通附件）';

    // 与 QQ 邮箱“更多操作 → 导出为 eml 文件”使用同一入口。
    // 让浏览器直接下载，避免把大附件完整载入脚本内存。
    const url = new URL('/read/readmail', 'https://wx.mail.qq.com');
    url.searchParams.set('func', '3');
    url.searchParams.set('mailid', mailId);
    url.searchParams.set('sid', sid);

    const link = document.createElement('a');
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.hidden = true;
    link.addEventListener('click', stopRowEvent);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function addButton(row) {
    if (!row.getAttribute('data-mailid')?.trim() || row.querySelector(`.${BUTTON_CLASS}`)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.textContent = '下载 EML';
    button.title = '下载这封邮件的原始 EML 文件（含邮件内的普通附件）';
    button.setAttribute('aria-label', '下载这封邮件为 EML 文件');

    // 防止选中邮件、打开邮件，以及双击时触发父级事件。
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'keydown', 'keyup']) {
      button.addEventListener(type, stopRowEvent);
    }
    button.addEventListener('click', download);
    row.appendChild(button);
  }

  function refresh() {
    if (!isInbox()) {
      document.querySelectorAll(`.${BUTTON_CLASS}`).forEach(button => button.remove());
      return;
    }
    document.querySelectorAll(ROW_SELECTOR).forEach(addButton);
  }

  let refreshTimer = null;
  function scheduleRefresh() {
    if (refreshTimer !== null) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refresh();
    }, 100);
  }

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-mailid'],
  });
  window.addEventListener('hashchange', scheduleRefresh);
  window.addEventListener('popstate', scheduleRefresh);
  refresh();
})();
