// Последний приказ своему кораблю: что и когда отдано. По нему приборы показывают состояние приказа
export const lastOrder = { type: '', t: -1, seq: 0, S: null, doneT: -1 };

// приказ отдан: type — вид приказа, t — время боя, seq — номер сетевого приказа гостя (0 — без сети)
export function logOrder(type, t, seq, state) {
  Object.assign(lastOrder, { type, t, seq, S: state, doneT: -1 });
}
