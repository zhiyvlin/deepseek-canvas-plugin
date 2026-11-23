window.App = window.App || {};
(function (App) {
  'use strict';

  var dom = {};

  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function btn(label, cls, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls || 'mini';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function shorten(s, n) {
    s = s || '';
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function statusText(s) {
    if (s === 'done') return '已完成';
    if (s === 'streaming') return '生成中';
    return '空白';
  }

  function effectiveAnswer(turn) {
    if (!turn) return '';
    if (turn.answerEdited != null && turn.answerEdited !== '') return turn.answerEdited;
    return turn.answerRaw || '';
  }

  var panel = {};

  panel.init = function () {
    dom.panel = document.getElementById('panel');
    App.store.on('selection', render);
    App.store.on('node', function (id) {
      if (id === App.store.ui.selectedNodeId) render();
    });
    render();
  };

  /* ---------------- 主渲染 ---------------- */

  function render() {
    var node = App.store.selectedNode();
    dom.panel.innerHTML = '';

    if (!node) {
      var empty = h('div', 'panel-empty');
      empty.appendChild(h('div', 'panel-empty-title', '您还没有选择对话标签'));
      empty.appendChild(h('div', 'panel-empty-sub', '在画布中点击任意标签查看对话，或点击左侧「新建对话标签」开始一轮新的提问。'));
      dom.panel.appendChild(empty);
      return;
    }

    var head = h('div', 'panel-head');
    var title = document.createElement('input');
    title.className = 'panel-title';
    title.value = node.title || '';
    title.placeholder = '未命名标签';
    title.addEventListener('input', function () {
      node.title = title.value;
      App.store.persist();
      App.canvas.syncTitle(node.id, title.value);
    });
    head.appendChild(title);
    head.appendChild(h('span', 'pill pill-' + node.status, statusText(node.status)));
    dom.panel.appendChild(head);

    dom.scroll = h('div', 'panel-scroll');
    dom.panel.appendChild(dom.scroll);

    var turn = node.turn;
    if (turn && turn.question) {
      dom.scroll.appendChild(userMessage(turn.question));
      var answer = effectiveAnswer(turn);
      if (answer || node.status === 'streaming') dom.scroll.appendChild(aiMessage(node));
      if (!answer && node.status !== 'streaming') {
        dom.scroll.appendChild(h('div', 'panel-note', '这条回答已被删除。你可以在下方重新提问，或直接编辑问题。'));
      }
    } else {
      var hint = h('div', 'panel-hint');
      hint.appendChild(h('div', 'panel-hint-title', node.status === 'streaming' ? '正在生成…' : '这个标签还没有内容'));
      hint.appendChild(h('div', 'panel-hint-sub', '在下面的输入框里写下你的问题，按 Enter 发送。'));
      dom.scroll.appendChild(hint);
    }

    dom.panel.appendChild(composer(node));

    if (node.status === 'streaming') {
      requestAnimationFrame(function () {
        if (dom.scroll) dom.scroll.scrollTop = dom.scroll.scrollHeight;
      });
    }
  }

  function userMessage(text) {
    var wrap = h('div', 'msg msg-user');
    wrap.appendChild(h('div', 'msg-label', '你'));
    var body = h('div', 'msg-body');
    body.textContent = text;
    wrap.appendChild(body);
    return wrap;
  }

  function aiMessage(node) {
    var turn = node.turn;
    var wrap = h('div', 'msg msg-ai');

    var label = h('div', 'msg-label');
    label.appendChild(document.createTextNode('DeepSeek'));
    if (turn.answerEdited != null) label.appendChild(h('span', 'tag-edited', '已编辑'));
    wrap.appendChild(label);

    var body = h('div', 'msg-body answer-text');
    body.textContent = effectiveAnswer(turn);
    if (node.status === 'streaming') body.classList.add('is-streaming');
    wrap.appendChild(body);

    var answer = effectiveAnswer(turn);
    if (answer && node.status !== 'streaming') {
      var actions = h('div', 'msg-actions');
      actions.appendChild(btn('编辑', 'mini', function () { startEdit(node, body, actions); }));

      if (turn.answerEdited != null) {
        actions.appendChild(btn('恢复原文', 'mini', function () {
          App.store.snapshot();
          turn.answerEdited = null;
          turn.editedAt = null;
          App.store.persist();
          App.canvas.syncNode(node.id);
          render();
        }));
      }

      actions.appendChild(btn('删除本条', 'mini danger', function () { clearAnswer(node); }));
      wrap.appendChild(actions);
    }

    return wrap;
  }

  function startEdit(node, body, actions) {
    var turn = node.turn;

    var ta = document.createElement('textarea');
    ta.className = 'answer-editor';
    ta.value = effectiveAnswer(turn);
    body.replaceWith(ta);
    actions.classList.add('is-hidden');

    var bar = h('div', 'editor-bar');
    bar.appendChild(h('span', 'editor-hint', 'Ctrl+Enter 保存 · Esc 取消'));

    var commit = function () {
      var val = ta.value.replace(/\s+$/, '');
      if (!val) { clearAnswer(node); return; }
      App.store.snapshot();
      if (val === (turn.answerRaw || '')) {
        turn.answerEdited = null;
        turn.editedAt = null;
      } else {
        turn.answerEdited = val;
        turn.editedAt = new Date().toISOString();
      }
      App.store.persist();
      render();
    };

    bar.appendChild(btn('取消', 'btn btn-ghost btn-sm', function () { render(); }));
    bar.appendChild(btn('保存', 'btn btn-primary btn-sm', commit));
    ta.insertAdjacentElement('afterend', bar);

    ta.style.height = 'auto';
    ta.style.height = Math.min(360, Math.max(120, ta.scrollHeight)) + 'px';
    ta.addEventListener('input', function () {
      ta.style.height = 'auto';
      ta.style.height = Math.min(360, ta.scrollHeight) + 'px';
    });

    ta.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        render();
      }
    });

    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function clearAnswer(node) {
    if (!node.turn) return;
    App.store.snapshot();
    node.turn.answerRaw = '';
    node.turn.answerEdited = null;
    node.turn.editedAt = null;
    node.status = 'draft';
    App.store.persist();
    App.canvas.syncNode(node.id);
    render();
  }

  /* ---------------- 底部输入区 ---------------- */

  function composer(node) {
    var wrap = h('div', 'composer');

    var ta = document.createElement('textarea');
    ta.className = 'composer-input';
    var locked = node.status === 'done' || node.status === 'streaming';
    ta.disabled = locked;
    ta.placeholder = node.status === 'done'
      ? '本标签已完成。要继续追问，请从它的右端口拉出一个新标签。'
      : '输入你的问题：Enter 发送，Shift+Enter 换行';
    if (node.turn && node.turn.question && !effectiveAnswer(node.turn)) {
      ta.value = node.turn.question;
    }
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit(node, ta);
      }
    });
    wrap.appendChild(ta);

    var bar = h('div', 'composer-bar');
    var ctxCount = App.store.contextFor(node.id).length;
    bar.appendChild(h('span', 'composer-hint',
      node.status === 'done'
        ? '已完成 · 下游标签会自动读取这条上下文'
        : '上游上下文 ' + ctxCount + ' 段'));

    if (node.status === 'streaming') {
      bar.appendChild(btn('停止', 'btn btn-ghost btn-sm', function () { stopStream(node); }));
    } else {
      var send = btn('发送', 'btn btn-primary btn-sm', function () { submit(node, ta); });
      send.disabled = node.status === 'done';
      bar.appendChild(send);
    }

    wrap.appendChild(bar);
    return wrap;
  }

  function submit(node, ta) {
    var text = ta.value.trim();
    if (!text) return;
    if (node.status === 'streaming' || node.status === 'done') return;

    App.store.snapshot();

    var turn = {
      id: App.store.uid('turn'),
      question: text,
      answerRaw: '',
      answerEdited: null,
      editedAt: null
    };
    node.turn = turn;
    node.status = 'streaming';
    if (!node.title) node.title = shorten(text.replace(/\s+/g, ' '), 24);

    var context = App.store.contextFor(node.id);

    App.store.persist();
    App.canvas.syncNode(node.id);
    render();

    App.api.ask({ nodeId: node.id, question: text, context: context }, {
      onDelta: function (delta) {
        turn.answerRaw += delta;
        panel.appendDelta(node.id, delta);
      },
      onDone: function (res) {
        node.status = 'done';
        if (res && res.answerRaw) turn.answerRaw = res.answerRaw;
        App.store.persist();
        App.canvas.syncNode(node.id);
        if (App.store.ui.selectedNodeId === node.id) render();
        App.store.emit('canvases');
      },
      onError: function (err) {
        node.status = 'draft';
        App.store.persist();
        App.canvas.syncNode(node.id);
        if (App.store.ui.selectedNodeId === node.id) render();
        App.toast((err && err.message) || '生成失败，请重试');
      }
    });
  }

  function stopStream(node) {
    App.api.cancel(node.id);
    if (node.status !== 'streaming') return;
    if ((node.turn && node.turn.answerRaw || '').trim()) {
      node.status = 'done';
    } else {
      node.status = 'draft';
      node.turn = null;
    }
    App.store.persist();
    App.canvas.syncNode(node.id);
    render();
  }

  /* ---------------- 流式增量 ---------------- */

  panel.appendDelta = function (nodeId, text) {
    if (App.store.ui.selectedNodeId !== nodeId) return;
    var body = dom.panel.querySelector('.answer-text');
    if (!body) return;
    body.textContent += text;
    if (dom.scroll) dom.scroll.scrollTop = dom.scroll.scrollHeight;
  };

  /* ---------------- 供其他模块调用 ---------------- */

  panel.syncTitle = function (id, value) {
    if (!dom.panel || App.store.ui.selectedNodeId !== id) return;
    var el = dom.panel.querySelector('.panel-title');
    if (el && document.activeElement !== el) el.value = value;
  };

  panel.editLast = function () {
    var node = App.store.selectedNode();
    var body = dom.panel.querySelector('.answer-text');
    var actions = dom.panel.querySelector('.msg-actions');
    if (node && body && actions) startEdit(node, body, actions);
  };

  panel.render = render;

  App.panel = panel;
})(window.App);