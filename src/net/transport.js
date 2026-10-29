// Транспорт сетевой игры: MQTT через брокер flespi.
// Топики: lobby/<код> — retained-объявление открытой комнаты; room/<код>/g — от гостя хосту; room/<код>/h — от хоста гостю
export const NET_CFG = { url: 'wss://mqtt.flespi.io', token: '', prefix: 'deltav/v3',
  lib: 'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js', maxSpeed: 10 };

// состояние сетевой сессии; role: null — одиночная игра, 'host' или 'guest'
export const net = {
  role: null, client: null, lobby: null, lobbyGen: 0, rooms: new Map(),
  room: '', id: '', nick: '', peerId: '', peerNick: '', joined: false, synced: false,
  seq: 0, ack: 0, // последний приказ гостя и последний принятый хостом
  lastRx: 0, lastSnap: 0, lastPing: 0, advAt: 0, rtt: 0, lost: false,
  peerSpeed: 1, peerAuto: true, pauseBy: '', pauseReason: '', holdUntil: 0, snapScale: 1,
  sayQ: [], ready: { me: false, foe: false },
};

export const topic = (...p) => [NET_CFG.prefix, ...p].join('/');
export const rid = n => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let r = ''; for (let i = 0; i < n; i++) r += A[Math.floor(Math.random() * A.length)]; return r; };
export const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (_) {} return null; };
export const urlToken = () => new URLSearchParams(location.search).get('token') || '';
// числа в сообщениях округляем до сотых: так короче
const round2 = (k, v) => typeof v === 'number' ? Math.round(v * 100) / 100 : v;

let mqttLib = null;
function loadMqtt() {
  if (!mqttLib) mqttLib = new Promise((ok, fail) => {
    if (window.mqtt) return ok(window.mqtt);
    const sc = document.createElement('script');
    sc.src = NET_CFG.lib;
    sc.onload = () => ok(window.mqtt);
    sc.onerror = () => { mqttLib = null; fail(new Error('не загрузилась библиотека MQTT')); };
    document.head.appendChild(sc);
  });
  return mqttLib;
}

// will — «завещание»: сообщение, которое брокер отправит сам, если клиент пропадёт.
// onLateError — ошибки после установленного соединения
export async function connect(token, will, onLateError) {
  if (!token) throw new Error('нужен токен flespi');
  const lib = await loadMqtt();
  return new Promise((ok, fail) => {
    const c = lib.connect(NET_CFG.url, { username: token, protocolVersion: 5, clean: true,
      clientId: 'deltav-' + rid(10), reconnectPeriod: 2000, connectTimeout: 8000, will });
    let first = true;
    c.on('connect', () => { if (first) { first = false; ok(c); } });
    c.on('error', e => { if (first) { first = false; c.end(true); fail(e); } else onLateError(e); });
  });
}

export function netSend(m, qos = 0) {
  const c = net.client;
  if (!c || !c.connected) return;
  m.from = net.id;
  if (net.role === 'host' && !m.to) m.to = net.peerId;
  c.publish(topic('room', net.room, net.role === 'host' ? 'h' : 'g'), JSON.stringify(m, round2), { qos });
}
