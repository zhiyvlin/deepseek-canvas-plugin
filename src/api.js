window.App = window.App || {};
(function (App) {
  'use strict';

  // 唯一的后端接入层。MOCK=true 时不发任何请求。
  // 已接入 DSH Host：请求打到同源的 /canvas/api/*（由插件 index.js + turn.js 处理）。
  var CONFIG = {
    MOCK: false,
    BASE_URL: '/canvas'
  };

  var active = null;

  function parseBlock(block) {
    var evt = 'message';
    var data = '';
    block.split('\n').forEach(function (line) {
      if (line.indexOf('event:') === 0) evt = line.slice(6).trim();
      else if (line.indexOf('data:') === 0) data += line.slice(5).trim();
    });
    if (!data) return null;
    try { return { event: evt, data: JSON.parse(data) }; }
    catch (err) { return null; }
  }

  async function askReal(payload, handlers) {
    var ctrl = new AbortController();
    var cancelled = false;
    var finished = false;

    function done(data) {
      if (finished) return;
      finished = true;
      handlers.onDone(data || {});
    }

    var handle = {
      nodeId: payload.nodeId,
      cancel: function () {
        cancelled = true;
        ctrl.abort();
      }
    };

    try {
      var res = await fetch(CONFIG.BASE_URL + '/api/nodes/' + payload.nodeId + '/turns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: payload.question,
          context: payload.context || []
        }),
        signal: ctrl.signal
      });

      if (!res.ok || !res.body) {
        handlers.onError({ code: 'HTTP_' + res.status, message: '服务端返回 ' + res.status });
        return handle;
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var blocks = buffer.split('\n\n');
        buffer = blocks.pop();
        blocks.forEach(function (b) {
          var msg = parseBlock(b);
          if (!msg) return;
          if (msg.event === 'delta' && msg.data && msg.data.text) handlers.onDelta(msg.data.text);
          else if (msg.event === 'done') done(msg.data);
          else if (msg.event === 'error') {
            finished = true;
            handlers.onError(msg.data || { message: '生成失败' });
          }
        });
      }
      done({});
    } catch (err) {
      if (!cancelled && !finished) {
        handlers.onError({ code: 'NETWORK', message: '连接中断，请重试' });
      }
    }
    return handle;
  }

  var api = {
    CONFIG: CONFIG,
    ask: function (payload, handlers) {
      if (CONFIG.MOCK) {
        active = App.mock.ask(payload, handlers);
        return active;
      }
      active = askReal(payload, handlers);
      return active;
    },
    cancel: function () {
      if (active) {
        active.cancel();
        active = null;
      }
    },
    // 其余 REST 端点：切到真实后端时按 docs/api-contract.md 直接调用
    request: function (method, path, body) {
      return fetch(CONFIG.BASE_URL + path, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      }).then(function (r) { return r.json(); });
    }
  };

  App.api = api;
})(window.App);