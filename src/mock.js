window.App = window.App || {};
(function (App) {
  'use strict';

  function shorten(s, n) {
    s = s || '';
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function build(payload) {
    var ctx = payload.context || [];
    var ctxLine = ctx.length
      ? '我读到了 ' + ctx.length + ' 段上游对话（' +
        ctx.map(function (c) { return '「' + shorten(c.question, 12) + '」'; }).join('、') +
        '），并已按拓扑顺序把它们作为上下文。'
      : '这一轮没有上游上下文，我只基于当前这个问题作答。';

    return [
      ctxLine,
      '',
      '关于「' + shorten(payload.question, 40) + '」，先说结论：这件事可以拆成三步推进。',
      '',
      '第一步，划定边界。先明确最终产出是什么形态、给谁用、失败的代价多大。边界不清时，后面所有讨论都会反复。',
      '第二步，把事实和假设分开。已经验证的写成事实，没验证的单独标注为假设，避免假设被当成前提继续往下推。',
      '第三步，做一个最小可验证版本。先用最小成本跑通一次，再决定要不要加细节。',
      '',
      '如果你需要，我可以把这三步展开成一份带时间点的执行清单。'
    ].join('\n');
  }

  App.mock = {
    ask: function (payload, handlers) {
      var cancelled = false;
      var timers = [];
      var text = build(payload);
      var i = 0;

      function tick() {
        if (cancelled) return;
        var step = 1 + Math.floor(Math.random() * 3);
        var chunk = text.slice(i, i + step);
        i += step;
        if (chunk) handlers.onDelta(chunk);
        if (i >= text.length) {
          handlers.onDone({ answerRaw: text, model: 'mock' });
          return;
        }
        timers.push(setTimeout(tick, 14 + Math.random() * 22));
      }

      timers.push(setTimeout(tick, 240));

      return {
        nodeId: payload.nodeId,
        cancel: function () {
          cancelled = true;
          timers.forEach(function (t) { clearTimeout(t); });
        }
      };
    }
  };
})(window.App);