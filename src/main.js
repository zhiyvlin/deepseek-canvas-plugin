window.App = window.App || {};
(function (App) {
  'use strict';

  var isDialogOpen = false;
  var spaceDown = false;

  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
    return !!el.isContentEditable;
  }

  /* ---------------- Toast ---------------- */

  App.toast = function (text) {
    var root = document.getElementById('toast-root');
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    root.appendChild(el);
    setTimeout(function () { el.classList.add('is-out'); }, 1800);
    setTimeout(function () { el.remove(); }, 2300);
  };

  /* ---------------- 确认弹窗 ---------------- */

  App.dialog = {
    isOpen: function () { return isDialogOpen; },

    confirm: function (opts) {
      var root = document.getElementById('modal-root');
      var lastFocus = document.activeElement;
      var confirmed = false;

      root.innerHTML = '';

      var overlay = document.createElement('div');
      overlay.className = 'overlay';

      var box = document.createElement('div');
      box.className = 'dialog';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');

      var title = document.createElement('div');
      title.className = 'dialog-title';
      title.textContent = opts.title || '确认';

      var msg = document.createElement('div');
      msg.className = 'dialog-msg';
      msg.textContent = opts.message || '';

      var actions = document.createElement('div');
      actions.className = 'dialog-actions';

      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn-ghost';
      cancel.textContent = '取消';

      var ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
      ok.textContent = opts.confirmText || '确定';

      actions.appendChild(cancel);
      actions.appendChild(ok);
      box.appendChild(title);
      box.appendChild(msg);
      box.appendChild(actions);
      overlay.appendChild(box);
      root.appendChild(overlay);

      function teardown() {
        isDialogOpen = false;
        document.removeEventListener('keydown', onKey, true);
        root.innerHTML = '';
      }

      function close() {
        if (confirmed) return;
        teardown();
        if (typeof opts.onCancel === 'function') opts.onCancel();
        if (lastFocus && lastFocus.focus) lastFocus.focus();
      }

      function doConfirm() {
        if (confirmed) return;
        confirmed = true;
        teardown();
        if (typeof opts.onConfirm === 'function') opts.onConfirm();
        if (lastFocus && lastFocus.focus) lastFocus.focus();
      }

      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          // 危险操作默认按钮是「取消」
          if (opts.danger) cancel.click();
          else doConfirm();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          if (document.activeElement === cancel) ok.focus();
          else cancel.focus();
        } else if (e.key === 'Tab') {
          if (document.activeElement === cancel) { e.preventDefault(); ok.focus(); }
          else if (document.activeElement === ok) { e.preventDefault(); cancel.focus(); }
        }
      }

      cancel.addEventListener('click', close);
      ok.addEventListener('click', doConfirm);
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close();
      });

      isDialogOpen = true;
      document.addEventListener('keydown', onKey, true);
      cancel.focus();
    }
  };

  /* ---------------- 导出 ---------------- */

  App.exportJSON = function () {
    var canvas = App.store.activeCanvas();
    if (!canvas) return;
    var blob = new Blob([JSON.stringify(canvas, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (canvas.title || '画布') + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  };

  /* ---------------- 三栏焦点循环 ---------------- */

  function cycleZone(backwards) {
    var zones = [
      document.getElementById('sidebar'),
      document.getElementById('canvas-wrap'),
      document.getElementById('panel')
    ];
    var idx = zones.indexOf(document.activeElement);
    if (idx === -1) {
      var host = document.activeElement && document.activeElement.closest
        ? document.activeElement.closest('#sidebar, #canvas-wrap, #panel')
        : null;
      idx = zones.indexOf(host);
    }
    var next = idx === -1 ? 0 : (idx + (backwards ? -1 : 1) + zones.length) % zones.length;
    zones[next].focus();
    if (next === 0) {
      var active = zones[0].querySelector('.canvas-item.is-active');
      if (active) active.focus();
    }
  }

  /* ---------------- 全局键位 ---------------- */

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (App.dialog.isOpen()) return;

      var mod = e.ctrlKey || e.metaKey;
      var key = e.key;

      // 新建对话 / 新建标签
      if (mod && (key === 'n' || key === 'N')) {
        e.preventDefault();
        if (e.shiftKey) {
          var node = App.canvas.createNodeAtCenter();
          if (node) App.canvas.ensureVisible(node);
        } else {
          App.store.createCanvas();
        }
        return;
      }

      // 撤销 / 重做（输入框内交给浏览器自己处理）
      if (mod && (key === 'z' || key === 'Z') && !isEditable(e.target)) {
        e.preventDefault();
        if (e.shiftKey) App.store.redo();
        else App.store.undo();
        return;
      }

      // 导出当前画布
      if (mod && (key === 's' || key === 'S')) {
        e.preventDefault();
        App.exportJSON();
        return;
      }

      // 空格平移
      if (key === ' ' && !isEditable(e.target)) {
        e.preventDefault();
        if (!spaceDown) {
          spaceDown = true;
          App.canvas.setSpace(true);
        }
        return;
      }

      // Esc 逐层退出
      if (key === 'Escape') {
        if (isEditable(document.activeElement)) {
          document.activeElement.blur();
          return;
        }
        if (App.store.ui.selectedNodeId || App.store.ui.selectedEdgeId) {
          App.store.ui.selectedNodeId = null;
          App.store.ui.selectedEdgeId = null;
          App.store.emit('selection');
          App.canvas.refreshSelection();
        }
        return;
      }

      if (isEditable(e.target)) return;

      if (key === 'Tab') {
        e.preventDefault();
        cycleZone(e.shiftKey);
        return;
      }
      if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault();
        App.canvas.deleteSelected();
        return;
      }
      if (key === 'F2' || key === 'Enter') {
        e.preventDefault();
        App.canvas.renameSelected();
        return;
      }
      if (key === '0') { e.preventDefault(); App.canvas.zoomTo(1); return; }
      if (key === '1') { e.preventDefault(); App.canvas.fit(); return; }
      if (key === '+' || key === '=') { e.preventDefault(); App.canvas.zoomBy(1.2); return; }
      if (key === '-' || key === '_') { e.preventDefault(); App.canvas.zoomBy(1 / 1.2); return; }
      if (key === 'ArrowLeft') { e.preventDefault(); App.canvas.selectSpatial('left'); return; }
      if (key === 'ArrowRight') { e.preventDefault(); App.canvas.selectSpatial('right'); return; }
      if (key === 'ArrowUp') { e.preventDefault(); App.canvas.selectSpatial('up'); return; }
      if (key === 'ArrowDown') { e.preventDefault(); App.canvas.selectSpatial('down'); return; }
      if (key === 'e' || key === 'E') { App.panel.editLast(); return; }
    });

    document.addEventListener('keyup', function (e) {
      if (e.key === ' ') {
        spaceDown = false;
        App.canvas.setSpace(false);
      }
    });

    window.addEventListener('blur', function () {
      spaceDown = false;
      App.canvas.setSpace(false);
    });
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    App.store.init();
    App.canvas.init();
    App.sidebar.init();
    App.panel.init();
    bindKeys();

    document.getElementById('zoom-in').addEventListener('click', function () { App.canvas.zoomBy(1.2); });
    document.getElementById('zoom-out').addEventListener('click', function () { App.canvas.zoomBy(1 / 1.2); });
    document.getElementById('zoom-fit').addEventListener('click', function () { App.canvas.fit(); });

    App.store.emit('canvases');
    App.store.emit('canvas');
    App.store.emit('selection');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.App);