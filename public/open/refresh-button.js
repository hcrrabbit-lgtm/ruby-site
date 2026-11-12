// 全站共用：右下角「重新整理」按鈕
// 放在 /open/ 底下，讓不用登入的孩子頁面也載得到。
(function () {
  if (window.top !== window.self) return; // 被嵌在別的頁面裡時不出現
  if (document.getElementById('ruby-refresh-btn')) return;

  var css =
    '#ruby-refresh-btn{position:fixed;right:calc(16px + env(safe-area-inset-right));' +
    'bottom:calc(16px + env(safe-area-inset-bottom));z-index:9999;width:44px;height:44px;' +
    'border-radius:50%;border:1px solid rgba(59,53,45,.15);background:rgba(255,252,246,.92);' +
    'color:#3B352D;box-shadow:0 3px 10px rgba(0,0,0,.15);cursor:pointer;display:flex;' +
    'align-items:center;justify-content:center;padding:0;-webkit-tap-highlight-color:transparent;' +
    'opacity:.85;transition:opacity .2s,transform .15s;}' +
    '#ruby-refresh-btn:hover{opacity:1;}' +
    '#ruby-refresh-btn:active{transform:scale(.92);}' +
    '#ruby-refresh-btn svg{width:22px;height:22px;}' +
    '#ruby-refresh-btn.spin svg{animation:rubyRefreshSpin .7s linear infinite;}' +
    '@keyframes rubyRefreshSpin{to{transform:rotate(360deg);}}' +
    '@media print{#ruby-refresh-btn{display:none;}}';

  function add() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var btn = document.createElement('button');
    btn.id = 'ruby-refresh-btn';
    btn.type = 'button';
    btn.title = '重新整理';
    btn.setAttribute('aria-label', '重新整理');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/>' +
      '<path d="M20 4v7h-7"/></svg>';
    btn.addEventListener('click', function () {
      btn.classList.add('spin');
      setTimeout(function () { location.reload(); }, 150);
    });
    document.body.appendChild(btn);
  }

  if (document.body) add();
  else document.addEventListener('DOMContentLoaded', add);
})();
