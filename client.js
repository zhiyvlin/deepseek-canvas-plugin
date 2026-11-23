// 画布式对话 · 客户端半边（浏览器）
//
// 这是 DeepSeek Harness「客户端模块系统」要求的 lazy-CJS 工厂格式：
//   一段脚本调用 window.__ModuleLoader__.load({ id, factory })，其中
//   id 必须等于本包名，factory(require) 内用 require() 取宿主提供的
//   react / 原语，最后导出 Cordis 插件（inject + apply）。
//
// 职责：在对话会话头部注入一个「画布」按钮，点击后在新标签页打开
// Host 侧托管的整页画布（/canvas/）。不覆盖任何现有界面，不锁人。

window.__ModuleLoader__.load({
  id: `deepseek-canvas-plugin`,
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: `Module` });

    var React = require('react');
    var linkStyle = {
      boxSizing:'border-box',
      display:'inline-flex',
      alignItems:'center',
      justifyContent:'center',
      gap:6,
      height:28,
      padding:'0 10px',
      borderRadius:'var(--dsw-radius-sm,6px)',
      border:'none',
      boxShadow:'inset 0 0 0 0.5px var(--dsw-alias-border-l3, #d0d5dd)',
      color: 'var(--dsw-alias-label-primary, #1b1f24)',
      fontSize: 12,
      lineHeight: '18px',
      cursor: 'pointer',
      textDecoration: 'none',
      whiteSpace: 'nowrap',
    };

    // 一个简单的节点连线小图标，让按钮在头部更醒目。
    function CanvasIcon() {
      return React.createElement(
        'svg',
        {
          width: 14, height: 14, viewBox: '0 0 24 24',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
          strokeLinecap: 'round', strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { flexShrink: 0 },
        },
        React.createElement('rect', { x: 3, y: 3, width: 7, height: 7, rx: 1.5 }),
        React.createElement('rect', { x: 14, y: 14, width: 7, height: 7, rx: 1.5 }),
        React.createElement('path', { d: 'M6.5 10v7' }),
        React.createElement('path', { d: 'M17.5 10v4' }),
        React.createElement('path', { d: 'M10 17.5h4' }),
      );
    }

    // 会话头部动作按钮：打开画布。组件忽略槽位注入的其余 props。
    function CanvasOpenButton() {
      return React.createElement(
        'a',
        {
          href:'/canvas/',
          target:'_blank',
          rel:'noopener noreferrer',
          title: '在画布中打开对话',
          style:linkStyle,
          },
        
        React.createElement(CanvasIcon),
        '画布',
      );
    }

    exports.inject = ['slots'];

    exports.apply = function (ctx) {
      // conversation.session.header.actions 是一个 list 槽，注册一个
      // 带唯一 id 的入口即可；order 决定与其它头部动作的相对顺序。
      ctx.slots.inject('conversation.session.header.actions', function () {
        return ctx.slots.register(
          {
            name: 'conversation.session.header.actions',
            id: 'canvas',
            order: 100,
          },
          CanvasOpenButton,
        );
      });
    };

    return module.exports;
  },
});
