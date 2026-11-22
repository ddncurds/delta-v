# Дельта-v: тактический бой кораблей в пустоте
# make help — список команд

PORT ?= 8080
NODE ?= node
JS := offline.js $(shell find src scripts tests -name "*.js" -o -name "*.mjs")

.DEFAULT_GOAL := help
.PHONY: help run offline test test-sim test-net test-e2e test-ui check ci bench

help: ## список команд
	@grep -E "^[a-z0-9-]+:.*## " $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  make %-10s %s\n", $$1, $$2}'

run: offline ## запустить игру на http://localhost:8080, другой порт: make run PORT=3000
	$(NODE) scripts/serve.mjs $(PORT)

offline: ## пересобрать offline.js — запуск игры из index.html, открытого как файл
	$(NODE) scripts/offline.mjs

test: ## все тесты
	$(NODE) --test tests/*.test.js

test-sim: ## тесты симуляции: топливо, корабль, оружие, сенсоры, мир, команды, состав, ИИ
	$(NODE) --test tests/fuel.test.js tests/ship.test.js tests/weapons.test.js tests/sensors.test.js tests/world.test.js tests/teams.test.js tests/roster.test.js tests/ai.test.js

test-net: ## тесты сетевого боя: снимки, лобби, хост, гость и сквозной бой хоста с двумя гостями
	$(NODE) --test tests/net.test.js tests/mp-lobby.test.js tests/mp-host.test.js tests/mp-guest.test.js tests/mp-e2e.test.js

test-e2e: ## только сквозной сетевой бой: три копии игры в отдельных потоках
	$(NODE) --test tests/mp-e2e.test.js

test-ui: ## тесты интерфейса, языков и сервера разработки
	$(NODE) --test tests/ui.test.js tests/i18n-core.test.js tests/i18n-ui.test.js tests/serve.test.js tests/offline.test.js

bench: ## стенд ИИ против ИИ: make bench ARGS="--a new --b baseline --n 1000"
	$(NODE) scripts/bench.mjs $(ARGS)

check: ## проверить синтаксис всех модулей
	@for f in $(JS); do $(NODE) --check $$f || exit 1; done; echo "синтаксис в порядке: $(words $(JS)) файлов"

ci: check test ## проверка перед коммитом
