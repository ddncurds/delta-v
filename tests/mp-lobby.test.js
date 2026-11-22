// Лобби сетевого боя: токен, список комнат, вход по коду и по ссылке, ошибки связи
import test from 'node:test';
import assert from 'node:assert/strict';
import { dom } from './dom-stub.js';
import './lang-ru.js';
import { FakeClient, broker } from './fake-mqtt.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = id => dom.byId.get(id);
const P = 'deltav/v4';

// комнаты, объявленные до запуска игры: свежая и устаревшая
const other = new FakeClient();
other.publish(`${P}/lobby/ROOM`, JSON.stringify({ name: 'Вася', created: Date.now(), free: 2, size: [2, 2] }), { retain: true });
other.publish(`${P}/lobby/OLD1`, JSON.stringify({ name: 'Старый', created: Date.now() - 20 * 60e3, free: 1 }), { retain: true });

// игру открыли по ссылке-приглашению, но токена ещё нет
location.hash = '#room=ab12';
const errors = [];
process.on('uncaughtException', e => errors.push(e));
process.on('unhandledRejection', e => errors.push(e));
const { net, NET_CFG } = await import('../src/net/transport.js');
const { joinFromUrl } = await import('../src/net/multiplayer.js');
await import('../src/main.js');

const rooms = () => $('mpRooms').children.filter(c => c.tagName === 'BUTTON');
const setToken = v => { $('mpToken').value = v; $('mpToken').dispatch('change'); };

test('без токена: просим вставить токен, код из ссылки уже в поле', async () => {
  await wait(10);
  assert.equal($('mpTokRow').hidden, false);
  assert.match($('mpStatus').textContent, /вставьте токен flespi/);
  assert.equal($('mpCode').value, 'AB12');
  assert.equal(net.role, null, 'без токена в комнату не входим');
  assert.equal(broker.connects, 1, 'к брокеру подключался только тест');
});

test('с токеном лобби показывает открытые комнаты, устаревшие скрыты', async () => {
  setToken('tok');
  await wait(20);
  const list = rooms();
  assert.equal(list.length, 1);
  assert.equal(list[0].children[0].textContent, 'Бой у Вася, свободно мест: 2, 2 на 2');
  assert.equal(list[0].children[1].textContent, 'ROOM');
});

test('список обновляется на лету: новая комната появляется, закрытая пропадает', async () => {
  other.publish(`${P}/lobby/NEW2`, JSON.stringify({ name: 'Петя', created: Date.now(), free: 1, size: [1, 1] }), { retain: true });
  await wait(20);
  assert.deepEqual(rooms().map(b => b.children[1].textContent), ['ROOM', 'NEW2']);
  other.publish(`${P}/lobby/NEW2`, '', { retain: true });
  await wait(20);
  assert.deepEqual(rooms().map(b => b.children[1].textContent), ['ROOM']);
  other.publish(`${P}/lobby/ROOM`, '', { retain: true });
  await wait(20);
  assert.equal(rooms().length, 0);
  assert.equal($('mpRooms').children[0].textContent, 'Открытых боёв пока нет');
});

test('код комнаты проверяется', async () => {
  $('mpCode').value = 'A-1'; $('mpJoin').click();
  assert.equal($('mpStatus').textContent, 'Код комнаты — 4 символа');
  assert.equal(net.role, null);
});

test('комната не отвечает — через срок ожидания возвращаемся в лобби', async () => {
  NET_CFG.joinTimeout = 100;
  other.publish(`${P}/lobby/ROOM`, JSON.stringify({ name: 'Вася', created: Date.now(), free: 1 }), { retain: true });
  await wait(20);
  rooms()[0].click();
  await wait(20);
  assert.equal(net.role, 'guest');
  assert.equal(net.room, 'ROOM');
  assert.equal($('mpMenu').hidden, true);
  assert.equal($('mpLeave').hidden, false);
  await wait(150);
  assert.equal(net.role, null);
  assert.equal($('mpStatus').textContent, 'Комната ROOM не отвечает.');
  assert.equal($('mpMenu').hidden, false);
});

test('гость оставляет брокеру «завещание»: при обрыве хост узнает, что связь пропала', async () => {
  NET_CFG.joinTimeout = 8000;
  $('mpCode').value = 'room'; $('mpJoin').click();
  await wait(20);
  const me = [...broker.clients].find(c => c.opts.will?.topic === `${P}/room/ROOM/g`);
  assert.ok(me);
  assert.deepEqual(JSON.parse(me.opts.will.payload), { type: 'gone', from: net.id });
  $('mpLeave').click();
  await wait(20);
  assert.equal(net.role, null);
});

test('не удалось подключиться при создании комнаты — понятное сообщение, меню снова доступно', async () => {
  broker.failNext = 'нет сети';
  $('mpHost').click();
  await wait(20);
  assert.equal(net.role, null);
  assert.equal($('mpStatus').textContent, 'Не удалось подключиться: нет сети');
  assert.equal($('mpMenu').hidden, false);
});

test('нет связи с брокером для лобби — сообщение в статусе', async () => {
  broker.failNext = 'отказ';
  setToken('tok2');
  await wait(20);
  assert.equal($('mpStatus').textContent, 'Нет связи с flespi: отказ');
  assert.equal(rooms().length, 0);
});

test('хост объявляет комнату с хоста: адрес страницы — ссылка-приглашение, её можно скопировать', async () => {
  setToken('tok'); await wait(20);
  $('mpNick').value = 'Аня';
  $('mpHost').click();
  await wait(20);
  assert.equal(location.hash, '#room=' + net.room);
  assert.equal($('mpLink').hidden, false);
  $('mpLink').click();
  await wait(10);
  assert.equal(dom.clipboard, 'http://localhost:8080/#room=' + net.room);
  assert.match($('mpStatus').textContent, /Ссылка скопирована/);
  const ad = JSON.parse(broker.retained.get(`${P}/lobby/${net.room}`));
  assert.equal(ad.name, 'Аня');
  $('mpLeave').click();
  await wait(20);
  assert.equal(location.hash, '', 'после выхода ссылка убрана');
  assert.equal(broker.retained.has(`${P}/lobby/${net.room}`), false);
});

test('токен в адресе страницы: поле токена скрыто, по ссылке с комнатой входим сразу', async () => {
  location.search = '?token=urltok';
  setToken('');
  assert.equal($('mpTokRow').hidden, true);
  location.hash = '#room=zz99';
  joinFromUrl();
  await wait(20);
  assert.equal(net.role, 'guest');
  assert.equal(net.room, 'ZZ99');
  const c = [...broker.clients].find(x => x.opts.username === 'urltok');
  assert.ok(c, 'подключились с токеном из адреса');
  $('mpLeave').click();
  await wait(20);
  assert.deepEqual(errors, []);
});
