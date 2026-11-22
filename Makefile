# Дельта-v: тактический бой кораблей в пустоте
# make help — список команд

PORT ?= 8080
NODE ?= node
JS := $(shell find src scripts tests -name "*.js" -o -name "*.mjs")

.DEFAULT_GOAL := help
.PHONY: help run test test-sim test-net test-e2e test-ui check ci

help: ## список команд
	@grep -E "^[a-z0-9-]+:.*## " $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  make %-10s %s\n", $$1, $$2}'

run: ## запустить игру на http://localhost:8080, другой порт: make run PORT=3000
	$(NODE) scripts/serve.mjs $(PORT)

test: ## все тесты
	$(NODE) --test tests/*.test.js

test-sim: ## тесты симуляции: топливо, корабль, оружие, сенсоры, мир, команды, состав
	$(NODE) --test tests/fuel.test.js tests/ship.test.js tests/weapons.test.js tests/sensors.test.js tests/world.test.js tests/teams.test.js tests/roster.test.js

test-net: ## тесты сетевого боя: снимки, лобби, хост, гость и сквозной бой хоста с двумя гостями
	$(NODE) --test tests/net.test.js tests/mp-lobby.test.js tests/mp-host.test.js tests/mp-guest.test.js tests/mp-e2e.test.js

test-e2e: ## только сквозной сетевой бой: три копии игры в отдельных потоках
	$(NODE) --test tests/mp-e2e.test.js

test-ui: ## тесты интерфейса и сервера разработки
	$(NODE) --test tests/ui.test.js tests/serve.test.js

check: ## проверить синтаксис всех модулей
	@for f in $(JS); do $(NODE) --check $$f || exit 1; done; echo "синтаксис в порядке: $(words $(JS)) файлов"

ci: check test ## проверка перед коммитом
