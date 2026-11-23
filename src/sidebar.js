window.App = window.App || {};
(function (App) {
  'use strict';

  var dom = {};
  var renaming = false;

  function init() {
    dom.list = document.getElementById('canvas-list');

    document.getElementById('btn-new-canvas').addEventListener('click', function () {
      App.store.createCanvas();
    });

    document.getElementById('btn-new-node').addEventListener('click', function () {
      var node = App.canvas.createNodeAtCenter();
      if (node) App.canvas.ensureVisible(node);
    });

    App.store.on('canvases', render);
    render();
  }

  function render() {
    var data = App.store.data;
    dom.list.innerHTML = '';

    data.canvases.forEach(function (cv) {
      var li = document.createElement('li');
      li.className = 'canvas-item' + (cv.id === data.activeCanvasId ? ' is-active' : '');
      li.tabIndex = 0;
      li.dataset.id = cv.id;

      var main = document.createElement('div');
      main.className = 'canvas-item-main';

      var title = document.createElement('div');
      title.className = 'canvas-title';
      title.textContent = cv.title;

      var meta = document.createElement('div');
      meta.className = 'canvas-meta';
      meta.textContent = cv.nodes.length + ' 个标签 · ' + cv.edges.length + ' 条连线';

      main.appendChild(title);
      main.appendChild(meta);

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'canvas-del';
      del.title = '删除对话';
      del.textContent = '×';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        askDelete(cv);
      });

      li.appendChild(main);
      li.appendChild(del);

      li.addEventListener('click', function () {
        App.store.setActiveCanvas(cv.id);
      });
      li.addEventListener('dblclick', function (e) {
        e.preventDefault();
        startRename(cv, title);
      });
      li.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          App.store.setActiveCanvas(cv.id);
        } else if (e.key === 'F2') {
          e.preventDefault();
          startRename(cv, title);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          askDelete(cv);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          var items = Array.prototype.slice.call(dom.list.querySelectorAll('.canvas-item'));
          var i = items.indexOf(li);
          var next = items[i + (e.key === 'ArrowDown' ? 1 : -1)];
          if (next) {
            var id = next.dataset.id;
            App.store.setActiveCanvas(id);
            var fresh = dom.list.querySelector('[data-id="' + id + '"]');
            if (fresh) fresh.focus();
          }
        }
      });

      dom.list.appendChild(li);
    });
  }

  function startRename(cv, titleEl) {
    if (renaming) return;
    renaming = true;
    var input = document.createElement('input');
    input.className = 'canvas-title-input';
    input.value = cv.title;
    titleEl.replaceWith(input);
    input.focus();
    input.select();

    var settled = false;
    function done(save) {
      if (settled) return;
      settled = true;
      renaming = false;
      if (save && input.value.trim()) App.store.renameCanvas(cv.id, input.value.trim());
      render();
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      else if (e.key === 'Escape') { e.preventDefault(); done(false); }
    });
    input.addEventListener('blur', function () { done(true); });
  }

  function askDelete(cv) {
    App.dialog.confirm({
      title: '删除对话',
      message: '「' + cv.title + '」下的全部标签和连线都会被删除。可用 Ctrl+Z 撤销。',
      confirmText: '删除',
      danger: true,
      onConfirm: function () { App.store.deleteCanvas(cv.id); }
    });
  }

  App.sidebar = { init: init, render: render };
})(window.App);