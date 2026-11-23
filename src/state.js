window.App = window.App || {};
(function (App) {
  'use strict';

  const STORAGE_KEY = 'deepseek-canvas:v1';
  const MAX_UNDO = 60;
  let counter = 0;

  function uid(prefix) {
    counter += 1;
    return prefix + '_' + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 5);
  }
  function nowISO() { return new Date().toISOString(); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  const store = {
    data: { canvases: [], activeCanvasId: null },
    ui: { selectedNodeId: null, selectedEdgeId: null },
    undoStack: [],
    redoStack: [],
    _bus: {},
    _saveTimer: null
  };
  store.uid = uid;

  /* ---------------- 事件总线 ---------------- */

  store.on = function (evt, fn) {
    (store._bus[evt] = store._bus[evt] || []).push(fn);
    return function () { store._bus[evt] = store._bus[evt].filter(function (f) { return f !== fn; }); };
  };

  store.emit = function (evt, payload) {
    (store._bus[evt] || []).forEach(function (fn) {
      try { fn(payload); } catch (err) { console.error(err); }
    });
  };

  /* ---------------- 持久化 ---------------- */

  store.persistNow = function () {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store.data)); }
    catch (err) { console.warn('本地保存失败', err); }
  };

  store.persist = function () {
    clearTimeout(store._saveTimer);
    store._saveTimer = setTimeout(store.persistNow, 300);
  };

  function makeCanvas(title) {
    return {
      id: uid('cv'),
      title: title,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      viewport: { x: 0, y: 0, scale: 1 },
      nodes: [],
      edges: []
    };
  }

  store.init = function () {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.canvases) && parsed.canvases.length) {
          store.data = parsed;
        }
      }
    } catch (err) {
      console.warn('本地数据损坏，已重置', err);
      store.data = { canvases: [], activeCanvasId: null };
    }

    if (!store.data.canvases.length) {
      var cv = makeCanvas('新对话 1');
      store.data.canvases.push(cv);
      store.data.activeCanvasId = cv.id;
      store.persistNow();
    }
    if (!store.activeCanvas()) {
      store.data.activeCanvasId = store.data.canvases[0].id;
    }

    // 页面隐藏/关闭前强制落盘，避免 300ms 防抖窗口丢数据
    window.addEventListener('pagehide', store.persistNow);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') store.persistNow();
    });
  };

  /* ---------------- 读取 ---------------- */

  store.activeCanvas = function () {
    return store.canvasById(store.data.activeCanvasId);
  };

  store.canvasById = function (id) {
    return store.data.canvases.filter(function (c) { return c.id === id; })[0] || null;
  };

  store.nodeById = function (id) {
    var canvas = store.activeCanvas();
    if (!canvas) return null;
    return canvas.nodes.filter(function (n) { return n.id === id; })[0] || null;
  };

  store.selectedNode = function () {
    return store.ui.selectedNodeId ? store.nodeById(store.ui.selectedNodeId) : null;
  };

  store.selectedEdge = function () {
    var canvas = store.activeCanvas();
    if (!canvas || !store.ui.selectedEdgeId) return null;
    return canvas.edges.filter(function (e) { return e.id === store.ui.selectedEdgeId; })[0] || null;
  };

  /* ---------------- 撤销栈 ---------------- */

  store.snapshot = function () {
    store.undoStack.push(JSON.stringify(store.data));
    if (store.undoStack.length > MAX_UNDO) store.undoStack.shift();
    store.redoStack.length = 0;
  };

  store.undo = function () {
    if (!store.undoStack.length) return false;
    store.redoStack.push(JSON.stringify(store.data));
    store.data = JSON.parse(store.undoStack.pop());
    afterHistoryJump();
    return true;
  };

  store.redo = function () {
    if (!store.redoStack.length) return false;
    store.undoStack.push(JSON.stringify(store.data));
    store.data = JSON.parse(store.redoStack.pop());
    afterHistoryJump();
    return true;
  };

  function afterHistoryJump() {
    var canvas = store.activeCanvas();
    if (!canvas) {
      if (store.data.canvases.length) {
        store.data.activeCanvasId = store.data.canvases[0].id;
      }
      canvas = store.activeCanvas();
    }
    if (canvas && !store.nodeById(store.ui.selectedNodeId)) store.ui.selectedNodeId = null;
    if (canvas && !store.selectedEdge()) store.ui.selectedEdgeId = null;
    store.persistNow();
    store.emit('canvases');
    store.emit('canvas');
    store.emit('selection');
  }

  /* ---------------- 对话（画布） ---------------- */

  store.setActiveCanvas = function (id) {
    if (!store.canvasById(id)) return;
    store.data.activeCanvasId = id;
    store.ui.selectedNodeId = null;
    store.ui.selectedEdgeId = null;
    store.persist();
    store.emit('canvases');
    store.emit('canvas');
    store.emit('selection');
  };

  store.createCanvas = function () {
    store.snapshot();
    var n = store.data.canvases.length + 1;
    var title = '新对话 ' + n;
    while (store.data.canvases.some(function (c) { return c.title === title; })) {
      n += 1;
      title = '新对话 ' + n;
    }
    var cv = makeCanvas(title);
    store.data.canvases.push(cv);
    store.data.activeCanvasId = cv.id;
    store.ui.selectedNodeId = null;
    store.ui.selectedEdgeId = null;
    store.persistNow();
    store.emit('canvases');
    store.emit('canvas');
    store.emit('selection');
    return cv;
  };

  store.renameCanvas = function (id, title) {
    var cv = store.canvasById(id);
    if (!cv) return;
    cv.title = title;
    cv.updatedAt = nowISO();
    store.persist();
    store.emit('canvases');
  };

  store.deleteCanvas = function (id) {
    if (store.data.canvases.length <= 1) return false;
    store.snapshot();
    store.data.canvases = store.data.canvases.filter(function (c) { return c.id !== id; });
    if (store.data.activeCanvasId === id) {
      store.data.activeCanvasId = store.data.canvases[0].id;
      store.ui.selectedNodeId = null;
      store.ui.selectedEdgeId = null;
    }
    store.persistNow();
    store.emit('canvases');
    store.emit('canvas');
    store.emit('selection');
    return true;
  };

  /* ---------------- 节点 ---------------- */

  store.createNode = function (x, y) {
    var canvas = store.activeCanvas();
    if (!canvas) return null;
    store.snapshot();
    var node = {
      id: uid('nd'),
      title: '',
      position: { x: Math.round(x), y: Math.round(y) },
      status: 'draft',
      turn: null,
      createdAt: nowISO()
    };
    canvas.nodes.push(node);
    canvas.updatedAt = nowISO();
    store.ui.selectedNodeId = node.id;
    store.ui.selectedEdgeId = null;
    store.persist();
    store.emit('canvas');
    store.emit('canvases');
    store.emit('selection');
    return node;
  };

  store.deleteNode = function (id) {
    var canvas = store.activeCanvas();
    if (!canvas) return;
    var node = store.nodeById(id);
    if (!node) return;
    store.snapshot();
    canvas.nodes = canvas.nodes.filter(function (n) { return n.id !== id; });
    canvas.edges = canvas.edges.filter(function (e) { return e.from !== id && e.to !== id; });
    if (store.ui.selectedNodeId === id) store.ui.selectedNodeId = null;
    if (!store.selectedEdge()) store.ui.selectedEdgeId = null;
    canvas.updatedAt = nowISO();
    store.persist();
    store.emit('canvas');
    store.emit('canvases');
    store.emit('selection');
  };

  store.patchNode = function (id, patch) {
    var node = store.nodeById(id);
    if (!node) return;
    Object.keys(patch).forEach(function (k) { node[k] = patch[k]; });
    store.persist();
    store.emit('node', id);
  };

  /* ---------------- 连线 ---------------- */

  function reaches(canvas, start, target) {
    var out = {};
    canvas.edges.forEach(function (e) { (out[e.from] = out[e.from] || []).push(e.to); });
    var stack = [start];
    var seen = {};
    while (stack.length) {
      var cur = stack.pop();
      if (cur === target) return true;
      if (seen[cur]) continue;
      seen[cur] = true;
      (out[cur] || []).forEach(function (n) { stack.push(n); });
    }
    return false;
  }

  store.addEdge = function (from, to) {
    var canvas = store.activeCanvas();
    if (!canvas) return { ok: false, message: '没有可用画布' };
    if (from === to) return { ok: false, message: '不能连接自己' };
    if (!store.nodeById(from) || !store.nodeById(to)) return { ok: false, message: '节点不存在' };
    var dup = canvas.edges.some(function (e) { return e.from === from && e.to === to; });
    if (dup) return { ok: false, message: '这两个标签已经连接' };
    if (reaches(canvas, to, from)) return { ok: false, message: '不能连接到上游节点（会成环）' };

    store.snapshot();
    var edge = { id: uid('eg'), from: from, to: to };
    canvas.edges.push(edge);
    canvas.updatedAt = nowISO();
    store.persist();
    store.emit('canvas');
    return { ok: true, edge: edge };
  };

  store.deleteEdge = function (id) {
    var canvas = store.activeCanvas();
    if (!canvas) return;
    store.snapshot();
    canvas.edges = canvas.edges.filter(function (e) { return e.id !== id; });
    if (store.ui.selectedEdgeId === id) store.ui.selectedEdgeId = null;
    store.persist();
    store.emit('canvas');
  };

  /* ---------------- 视图 ---------------- */

  store.setViewport = function (patch) {
    var canvas = store.activeCanvas();
    if (!canvas) return;
    Object.keys(patch).forEach(function (k) { canvas.viewport[k] = patch[k]; });
    store.persist();
  };

  /* ---------------- 上下文组装 ---------------- */

  function cmpPos(a, b) {
    var na = store.nodeById(a), nb = store.nodeById(b);
    if (!na || !nb) return 0;
    if (Math.abs(na.position.y - nb.position.y) > 4) return na.position.y - nb.position.y;
    return na.position.x - nb.position.x;
  }

  store.upstreamCount = function (nodeId) {
    return store.contextFor(nodeId, true).length;
  };

  // withMeta=true 时返回全部上游节点 id（不筛内容），用于计数
  store.contextFor = function (nodeId, withMeta) {
    var canvas = store.activeCanvas();
    if (!canvas) return [];

    var preds = {};
    canvas.edges.forEach(function (e) { (preds[e.to] = preds[e.to] || []).push(e.from); });

    var anc = new Set();
    var stack = [nodeId];
    while (stack.length) {
      var cur = stack.pop();
      (preds[cur] || []).forEach(function (p) {
        if (!anc.has(p)) { anc.add(p); stack.push(p); }
      });
    }
    if (!anc.size) return [];

    var indeg = {};
    anc.forEach(function (id) { indeg[id] = 0; });
    canvas.edges.forEach(function (e) {
      if (anc.has(e.from) && anc.has(e.to)) indeg[e.to] = (indeg[e.to] || 0) + 1;
    });

    var byId = {};
    canvas.nodes.forEach(function (n) { byId[n.id] = n; });

    var queue = Array.from(anc).filter(function (id) { return !indeg[id]; }).sort(cmpPos);
    var order = [];
    while (queue.length) {
      var id = queue.shift();
      order.push(id);
      canvas.edges.forEach(function (e) {
        if (e.from !== id || !anc.has(e.to)) return;
        indeg[e.to] -= 1;
        if (indeg[e.to] === 0) {
          queue.push(e.to);
          queue.sort(cmpPos);
        }
      });
    }
    anc.forEach(function (id) { if (order.indexOf(id) === -1) order.push(id); });

    if (withMeta) return order;

    var ctx = [];
    order.forEach(function (id) {
      var node = byId[id];
      if (!node || !node.turn) return;
      var answer = (node.turn.answerEdited && node.turn.answerEdited.trim())
        ? node.turn.answerEdited
        : (node.turn.answerRaw || '');
      if (!answer.trim()) return;
      ctx.push({ nodeId: id, question: node.turn.question, answer: answer });
    });
    return ctx;
  };

  App.store = store;
})(window.App);