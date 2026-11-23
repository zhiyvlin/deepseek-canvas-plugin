window.App = window.App || {};
(function (App) {
  'use strict';

  var NODE_W = 320;
  var NODE_H = 92;
  var PORT_Y = 46;
  var MIN_SCALE = 0.25;
  var MAX_SCALE = 2.5;

  var dom = {};
  var drag = null;
  var spaceDown = false;

  var canvasApi = {};
  App.canvas = canvasApi;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function bezier(x1, y1, x2, y2) {
    var dx = Math.max(60, Math.abs(x2 - x1) * 0.5);
    return 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2;
  }

  function statusText(s) {
    if (s === 'done') return '已完成';
    if (s === 'streaming') return '生成中';
    return '空白';
  }

  function shorten(s, n) {
    s = s || '';
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  // 新节点避让已有节点：优先向右、再向下寻找空位
  function freeSpot(base, nodes) {
    var stepX = NODE_W + 48;
    var stepY = NODE_H + 56;
    var pad = 16;

    function free(cand) {
      return !nodes.some(function (n) {
        return Math.abs(n.position.x - cand.x) < (NODE_W - pad) &&
               Math.abs(n.position.y - cand.y) < (NODE_H - pad);
      });
    }

    var candidates = [];
    for (var sum = 0; sum <= 10; sum++) {
      for (var i = sum; i >= 0; i--) {
        var j = sum - i;
        candidates.push({ i: i, j: j });
      }
    }

    for (var k = 0; k < candidates.length; k++) {
      var cand = {
        x: Math.round(base.x + candidates[k].i * stepX),
        y: Math.round(base.y + candidates[k].j * stepY)
      };
      if (free(cand)) return cand;
    }
    return base;
  }

  /* ---------------- 初始化 ---------------- */

  canvasApi.init = function () {
    dom.wrap = document.getElementById('canvas-wrap');
    dom.world = document.getElementById('world');
    dom.nodes = document.getElementById('nodes');
    dom.edges = document.getElementById('edges');
    dom.empty = document.getElementById('canvas-empty');
    dom.zoomLabel = document.getElementById('zoom-label');

    dom.wrap.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    dom.wrap.addEventListener('wheel', onWheel, { passive: false });
    dom.wrap.addEventListener('contextmenu', onContext);
    dom.wrap.addEventListener('auxclick', function (e) {
      if (e.button === 1) e.preventDefault();
    });

    App.store.on('canvas', render);
    App.store.on('selection', renderSelection);
    App.store.on('node', function (id) { syncNode(id); });

    render();
  };

  /* ---------------- 渲染 ---------------- */

  function render() {
    var canvas = App.store.activeCanvas();
    if (!canvas) {
      dom.nodes.innerHTML = '';
      dom.edges.innerHTML = '';
      if (dom.empty) dom.empty.hidden = true;
      return;
    }
    applyTransform(canvas.viewport);
    renderEdges(canvas);
    renderNodes(canvas);
    if (dom.empty) dom.empty.hidden = canvas.nodes.length > 0;
  }
  canvasApi.render = render;

  function applyTransform(vp) {
    dom.world.style.transform = 'translate(' + vp.x + 'px, ' + vp.y + 'px) scale(' + vp.scale + ')';
    if (dom.zoomLabel) dom.zoomLabel.textContent = Math.round(vp.scale * 100) + '%';
  }
  canvasApi.applyTransform = function () {
    var canvas = App.store.activeCanvas();
    if (canvas) applyTransform(canvas.viewport);
  };

  function renderNodes(canvas) {
    dom.nodes.innerHTML = '';
    canvas.nodes.forEach(function (n) { dom.nodes.appendChild(nodeEl(n)); });
  }

  function nodeEl(n) {
    var el = document.createElement('div');
    el.className = 'node status-' + n.status +
      (App.store.ui.selectedNodeId === n.id ? ' is-selected' : '');
    el.dataset.id = n.id;
    el.style.transform = 'translate(' + n.position.x + 'px, ' + n.position.y + 'px)';

    var pin = document.createElement('span');
    pin.className = 'port port-in';
    pin.dataset.dir = 'in';
    pin.title = '左端口：拖到其他标签，表示它在你上游';

    var pout = document.createElement('span');
    pout.className = 'port port-out';
    pout.dataset.dir = 'out';
    pout.title = '右端口：拖到其他标签，表示它接在你下游';

    var body = document.createElement('div');
    body.className = 'node-body';

    var meta = document.createElement('div');
    meta.className = 'node-meta';
    var dot = document.createElement('span');
    dot.className = 'dot';
    var badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = statusText(n.status);
    var up = document.createElement('span');
    up.className = 'up';
    up.textContent = '上游 ' + App.store.upstreamCount(n.id);
    meta.appendChild(dot);
    meta.appendChild(badge);
    meta.appendChild(up);

    var input = document.createElement('input');
    input.className = 'node-title';
    input.value = n.title || '';
    input.placeholder = n.turn && n.turn.question ? shorten(n.turn.question, 20) : '未命名标签';
    input.dataset.dirty = '0';
    input.addEventListener('focus', function () { input.dataset.dirty = '0'; });
    input.addEventListener('input', function () {
      if (input.dataset.dirty === '0') { App.store.snapshot(); input.dataset.dirty = '1'; }
      n.title = input.value;
      App.store.persist();
      if (App.panel && App.panel.syncTitle) App.panel.syncTitle(n.id, input.value);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = n.title; input.blur(); }
    });

    body.appendChild(meta);
    body.appendChild(input);
    el.appendChild(pin);
    el.appendChild(body);
    el.appendChild(pout);
    return el;
  }

  function renderEdges(canvas) {
    var byId = {};
    canvas.nodes.forEach(function (n) { byId[n.id] = n; });

    var html = '<defs><marker id="edge-arrow" viewBox="0 0 10 10" refX="9" refY="5" ' +
      'markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/></marker></defs>';

    canvas.edges.forEach(function (e) {
      var a = byId[e.from];
      var b = byId[e.to];
      if (!a || !b) return;
      var x1 = a.position.x + NODE_W;
      var y1 = a.position.y + PORT_Y;
      var x2 = b.position.x;
      var y2 = b.position.y + PORT_Y;
      var d = bezier(x1, y1, x2, y2);
      var sel = App.store.ui.selectedEdgeId === e.id ? ' is-selected' : '';
      html += '<path class="edge' + sel + '" d="' + d + '" marker-end="url(#edge-arrow)"/>';
      html += '<path class="edge-hit" d="' + d + '" data-edge="' + e.id + '"/>';
    });

    if (drag && drag.type === 'link' && drag.tempD) {
      html += '<path class="edge temp" d="' + drag.tempD + '"/>';
    }
    dom.edges.innerHTML = html;
  }

  function renderSelection() {
    var canvas = App.store.activeCanvas();
    if (!canvas) return;
    Array.prototype.forEach.call(dom.nodes.querySelectorAll('.node'), function (el) {
      el.classList.toggle('is-selected', el.dataset.id === App.store.ui.selectedNodeId);
    });
    renderEdges(canvas);
  }

  /* ---------------- 局部同步 ---------------- */

  function syncNode(id) {
    var node = App.store.nodeById(id);
    if (!node) return;
    var el = dom.nodes.querySelector('.node[data-id="' + id + '"]');
    if (!el) return;
    el.className = 'node status-' + node.status +
      (App.store.ui.selectedNodeId === id ? ' is-selected' : '');
    var badge = el.querySelector('.badge');
    if (badge) badge.textContent = statusText(node.status);
    var up = el.querySelector('.up');
    if (up) up.textContent = '上游 ' + App.store.upstreamCount(node.id);
    var input = el.querySelector('.node-title');
    if (input && document.activeElement !== input) {
      input.value = node.title || '';
      input.placeholder = node.turn && node.turn.question ? shorten(node.turn.question, 20) : '未命名标签';
    }
  }
  canvasApi.syncNode = syncNode;

  canvasApi.syncTitle = function (id, value) {
    var el = dom.nodes.querySelector('.node[data-id="' + id + '"] .node-title');
    if (el && document.activeElement !== el) el.value = value;
  };

  /* ---------------- 坐标 ---------------- */

  function toWorld(cx, cy) {
    var rect = dom.wrap.getBoundingClientRect();
    var vp = App.store.activeCanvas().viewport;
    return { x: (cx - rect.left - vp.x) / vp.scale, y: (cy - rect.top - vp.y) / vp.scale };
  }

  /* ---------------- 指针交互 ---------------- */

  function onDown(e) {
    if (e.target.closest('.canvas-hud')) return;
    var canvas = App.store.activeCanvas();
    if (!canvas) return;

    var nodeEl = e.target.closest('.node');
    var portEl = e.target.closest('.port');
    var edgeEl = e.target.closest('.edge-hit');

    if (e.button === 1) {
      e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && nodeEl) startNodeDrag(nodeEl, e);
      else startPan(e);
      return;
    }
    if (e.button !== 0) return;

    if (edgeEl) {
      App.store.ui.selectedEdgeId = edgeEl.dataset.edge;
      App.store.ui.selectedNodeId = null;
      App.store.emit('selection');
      return;
    }
    if (spaceDown) { startPan(e); return; }

    if (portEl && nodeEl) { startLink(nodeEl, portEl.dataset.dir, e); return; }

    if (nodeEl) {
      selectNode(nodeEl.dataset.id);
      if (e.target.closest('.node-title')) return;
      startNodeDrag(nodeEl, e);
      return;
    }

    selectNode(null);
    App.store.ui.selectedEdgeId = null;
    App.store.emit('selection');
  }

  function selectNode(id) {
    App.store.ui.selectedNodeId = id;
    App.store.ui.selectedEdgeId = null;
    App.store.emit('selection');
  }

  function startPan(e) {
    var canvas = App.store.activeCanvas();
    drag = {
      type: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      vx: canvas.viewport.x,
      vy: canvas.viewport.y
    };
    dom.wrap.classList.add('is-grabbing');
  }

  function startNodeDrag(el, e) {
    var node = App.store.nodeById(el.dataset.id);
    if (!node) return;
    var canvas = App.store.activeCanvas();
    selectNode(node.id);
    drag = {
      type: 'node',
      id: node.id,
      el: el,
      startX: e.clientX,
      startY: e.clientY,
      nx: node.position.x,
      ny: node.position.y,
      scale: canvas.viewport.scale,
      undoPushed: false
    };
    el.classList.add('is-dragging');
    dom.wrap.classList.add('is-grabbing');
  }

  function startLink(el, dir, e) {
    var node = App.store.nodeById(el.dataset.id);
    if (!node) return;
    var x = dir === 'out' ? node.position.x + NODE_W : node.position.x;
    var y = node.position.y + PORT_Y;
    drag = {
      type: 'link',
      nodeId: node.id,
      dir: dir,
      x1: x,
      y1: y,
      x2: x,
      y2: y,
      tempD: ''
    };
    selectNode(node.id);
  }

  function onMove(e) {
    if (!drag) return;

    if (drag.type === 'pan') {
      var canvas = App.store.activeCanvas();
      if (!canvas) return;
      canvas.viewport.x = drag.vx + (e.clientX - drag.startX);
      canvas.viewport.y = drag.vy + (e.clientY - drag.startY);
      applyTransform(canvas.viewport);
      App.store.persist();
      return;
    }

    if (drag.type === 'node') {
      var node = App.store.nodeById(drag.id);
      if (!node) return;
      if (!drag.undoPushed) { App.store.snapshot(); drag.undoPushed = true; }
      node.position.x = Math.round(drag.nx + (e.clientX - drag.startX) / drag.scale);
      node.position.y = Math.round(drag.ny + (e.clientY - drag.startY) / drag.scale);
      drag.el.style.transform = 'translate(' + node.position.x + 'px, ' + node.position.y + 'px)';
      renderEdges(App.store.activeCanvas());
      App.store.persist();
      return;
    }

    if (drag.type === 'link') {
      var p = toWorld(e.clientX, e.clientY);
      drag.tempD = drag.dir === 'out'
        ? bezier(drag.x1, drag.y1, p.x, p.y)
        : bezier(p.x, p.y, drag.x2, drag.y2);
      renderEdges(App.store.activeCanvas());
    }
  }

  function onUp(e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    dom.wrap.classList.remove('is-grabbing');
    if (d.el) d.el.classList.remove('is-dragging');

    if (d.type === 'link') {
      var hit = document.elementFromPoint(e.clientX, e.clientY);
      var target = hit ? hit.closest('.node') : null;
      if (target && target.dataset.id !== d.nodeId) {
        var from, to;
        if (d.dir === 'out') { from = d.nodeId; to = target.dataset.id; }
        else { from = target.dataset.id; to = d.nodeId; }
        var res = App.store.addEdge(from, to);
        if (!res.ok) App.toast(res.message);
      }
      render();
    }

    if (d.type === 'node') App.store.emit('node', d.id);
    if (d.type === 'node') App.store.emit('canvases');
  }

  function onWheel(e) {
    e.preventDefault();
    var canvas = App.store.activeCanvas();
    if (!canvas) return;
    var vp = canvas.viewport;
    var rect = dom.wrap.getBoundingClientRect();
    var px = e.clientX - rect.left;
    var py = e.clientY - rect.top;
    var factor = Math.exp(-e.deltaY * 0.0015);
    var next = clamp(vp.scale * factor, MIN_SCALE, MAX_SCALE);
    var k = next / vp.scale;
    vp.x = px - (px - vp.x) * k;
    vp.y = py - (py - vp.y) * k;
    vp.scale = next;
    applyTransform(vp);
    App.store.persist();
  }

  function onContext(e) {
    var nodeEl = e.target.closest('.node');
    if (!nodeEl) return;
    e.preventDefault();
    var node = App.store.nodeById(nodeEl.dataset.id);
    if (!node) return;
    selectNode(node.id);
    App.dialog.confirm({
      title: '删除对话标签',
      message: '删除后，与它相连的连线会一并断开。可用 Ctrl+Z 撤销。',
      confirmText: '删除',
      danger: true,
      onConfirm: function () {
        if (node.status === 'streaming' && App.api) App.api.cancel(node.id);
        App.store.deleteNode(node.id);
      }
    });
  }

  /* ---------------- 对外操作 ---------------- */

  canvasApi.setSpace = function (on) {
    spaceDown = !!on;
    dom.wrap.classList.toggle('space-pan', !!on);
  };

  canvasApi.focus = function () { dom.wrap.focus(); };

  canvasApi.createNodeAtCenter = function () {
    var canvas = App.store.activeCanvas();
    if (!canvas) return null;
    var rect = dom.wrap.getBoundingClientRect();
    var vp = canvas.viewport;
    var wx = (rect.width / 2 - vp.x) / vp.scale - NODE_W / 2;
    var wy = (rect.height / 2 - vp.y) / vp.scale - NODE_H / 2;
    var spot = freeSpot({ x: wx, y: wy }, canvas.nodes);
    return App.store.createNode(spot.x, spot.y);
  };

  canvasApi.zoomTo = function (scale) {
    var canvas = App.store.activeCanvas();
    if (!canvas) return;
    var rect = dom.wrap.getBoundingClientRect();
    var vp = canvas.viewport;
    var next = clamp(scale, MIN_SCALE, MAX_SCALE);
    var px = rect.width / 2;
    var py = rect.height / 2;
    var k = next / vp.scale;
    vp.x = px - (px - vp.x) * k;
    vp.y = py - (py - vp.y) * k;
    vp.scale = next;
    applyTransform(vp);
    App.store.persist();
  };

  canvasApi.zoomBy = function (k) {
    var canvas = App.store.activeCanvas();
    if (canvas) canvasApi.zoomTo(canvas.viewport.scale * k);
  };

  canvasApi.fit = function () {
    var canvas = App.store.activeCanvas();
    if (!canvas) return;
    var rect = dom.wrap.getBoundingClientRect();
    if (!canvas.nodes.length) {
      canvas.viewport = { x: 0, y: 0, scale: 1 };
      applyTransform(canvas.viewport);
      App.store.persist();
      return;
    }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    canvas.nodes.forEach(function (n) {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + NODE_W);
      maxY = Math.max(maxY, n.position.y + NODE_H);
    });
    var pad = 80;
    var bw = (maxX - minX) + pad * 2;
    var bh = (maxY - minY) + pad * 2;
    var scale = clamp(Math.min(rect.width / bw, rect.height / bh), MIN_SCALE, 1.2);
    canvas.viewport.scale = scale;
    canvas.viewport.x = rect.width / 2 - (minX + (maxX - minX) / 2) * scale;
    canvas.viewport.y = rect.height / 2 - (minY + (maxY - minY) / 2) * scale;
    applyTransform(canvas.viewport);
    App.store.persist();
  };

  canvasApi.ensureVisible = function (node) {
    var canvas = App.store.activeCanvas();
    if (!canvas || !node) return;
    var rect = dom.wrap.getBoundingClientRect();
    var vp = canvas.viewport;
    var x1 = node.position.x * vp.scale + vp.x;
    var y1 = node.position.y * vp.scale + vp.y;
    var x2 = x1 + NODE_W * vp.scale;
    var y2 = y1 + NODE_H * vp.scale;
    var pad = 40;
    var dx = 0, dy = 0;
    if (x1 < pad) dx = pad - x1;
    if (x2 > rect.width - pad) dx = (rect.width - pad) - x2;
    if (y1 < pad) dy = pad - y1;
    if (y2 > rect.height - pad) dy = (rect.height - pad) - y2;
    if (dx || dy) {
      vp.x += dx;
      vp.y += dy;
      applyTransform(vp);
      App.store.persist();
    }
  };

  canvasApi.selectSpatial = function (dir) {
    var canvas = App.store.activeCanvas();
    if (!canvas || !canvas.nodes.length) return;
    var cur = App.store.selectedNode();
    if (!cur) { selectNode(canvas.nodes[0].id); return; }

    var cx = cur.position.x + NODE_W / 2;
    var cy = cur.position.y + NODE_H / 2;
    var best = null;
    var bestScore = Infinity;

    canvas.nodes.forEach(function (n) {
      if (n.id === cur.id) return;
      var nx = n.position.x + NODE_W / 2;
      var ny = n.position.y + NODE_H / 2;
      var dx = nx - cx;
      var dy = ny - cy;
      var primary = 0;
      var secondary = 0;
      if (dir === 'left') { if (dx > -1) return; primary = -dx; secondary = Math.abs(dy); }
      else if (dir === 'right') { if (dx < 1) return; primary = dx; secondary = Math.abs(dy); }
      else if (dir === 'up') { if (dy > -1) return; primary = -dy; secondary = Math.abs(dx); }
      else { if (dy < 1) return; primary = dy; secondary = Math.abs(dx); }
      var score = primary + secondary * 2;
      if (score < bestScore) { bestScore = score; best = n; }
    });

    if (best) {
      selectNode(best.id);
      canvasApi.ensureVisible(best);
    }
  };

  canvasApi.renameSelected = function () {
    var node = App.store.selectedNode();
    if (!node) return;
    var el = dom.nodes.querySelector('.node[data-id="' + node.id + '"] .node-title');
    if (el) { el.focus(); el.select(); }
  };

  canvasApi.deleteSelected = function () {
    var edge = App.store.selectedEdge();
    if (edge) { App.store.deleteEdge(edge.id); return; }
    var node = App.store.selectedNode();
    if (!node) return;
    App.dialog.confirm({
      title: '删除对话标签',
      message: '删除后，与它相连的连线会一并断开。可用 Ctrl+Z 撤销。',
      confirmText: '删除',
      danger: true,
      onConfirm: function () {
        if (node.status === 'streaming' && App.api) App.api.cancel(node.id);
        App.store.deleteNode(node.id);
      }
    });
  };

  // 供外部（键盘 Tab / 选中变化）刷新选中样式
  canvasApi.refreshSelection = renderSelection;
})(window.App);