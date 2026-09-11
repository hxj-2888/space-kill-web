/* WebSocket 客户端：联机模式下由服务器权威驱动，客户端只渲染视图 + 提交决策 */
(function (global) {
  let ws = null, onMsg = null;
  let url = '', name = '', seat = 0, isHost = false;

  function connect(addr, nick, cb) {
    url = addr; name = nick; onMsg = cb;
    try { ws = new WebSocket(addr); }
    catch (e) { cb({ t: 'err', msg: '无法连接：' + e.message }); return; }
    ws.onopen = () => send({ t: 'hello', name });
    ws.onmessage = ev => {
      let m = null;
      try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.t === 'seat') { seat = m.seat; isHost = !!m.host; }
      cb(m);
    };
    ws.onclose = () => cb({ t: 'closed' });
    ws.onerror = () => cb({ t: 'err', msg: '连接失败，请确认服务器已启动' });
  }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  function decision(data) { send({ t: 'decision', data }); }
  function startGame(seed) { send({ t: 'start', seed }); }
  function again() { send({ t: 'again' }); }
  function close() { if (ws) { try { ws.close(); } catch (_) {} ws = null; } }
  function info() { return { url, name, seat, isHost }; }

  global.Net = { connect, send, decision, startGame, again, close, info };
})(typeof window !== 'undefined' ? window : globalThis);
