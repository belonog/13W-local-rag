# local-rag — техническая спецификация

## Обзор архитектуры

```
┌─────────────────────────────────────────────────────────┐
│                    Claude Code                          │
│                                                         │
│  UserPromptSubmit ──► hook-recall                       │
│                            │                            │
│                     systemMessage ◄── Qdrant            │
│                                          ▲              │
│  Stop / SessionEnd ──► hook-remember     │              │
│                            │             │              │
│                         Router ──────────┘              │
│                         (Gemma4)                        │
│                            │                            │
│                    request_validation                   │
│                       MCP tool ──► Claude (validates)   │
└─────────────────────────────────────────────────────────┘
```

Система состоит из четырёх слоёв:

1. **Хуки Claude Code** — точки входа в систему (hook-recall, hook-remember)
2. **LLM роутер** — лёгкая модель для анализа и классификации (Gemma4 / configurable)
3. **Векторная база** — Qdrant для хранения и семантического поиска
4. **MCP сервер** — интерфейс между local-rag и агентом

---

## Qdrant — схема данных

### Коллекции

| Коллекция | Назначение |
|-----------|-----------|
| `memory` | Основная память сессий (planning, editing, headless) |
| `memory_agents` | Память мультиагентных сессий (namespace по agent_id) |

### Payload схема

```typescript
type MemoryEntry = {
  text: string                    // содержимое записи
  status: Status                  // текущий статус
  session_id: string              // Claude Code session_id
  session_type: SessionType       // тип сессии
  created_at: string              // ISO timestamp
  updated_at: string              // ISO timestamp
  resolved_at: string | null      // ISO timestamp если resolved
  confidence: number              // 0.0 – 1.0
  source: string                  // "hook-remember:stop" | "hook-remember:session_end"
  agent_id?: string               // только для memory_agents
}

type Status = "in_progress" | "resolved" | "open_question" | "hypothesis"

type SessionType = "planning" | "editing" | "headless" | "multi_agent"
```

---

## MCP сервер — `get_info()` / `instructions`

При подключении Claude Code к MCP серверу, в поле `instructions` передаётся
живой snapshot текущего состояния памяти. Генерируется один раз при подключении.

### Формат snapshot

```
Project: <name>
Indexed: <N> symbols, last updated <timestamp>

Memory state:
  In progress (<N>): <краткий список>
  Open questions (<N>): <краткий список>
  Resolved today (<N>): <краткий список>

Recent activity: <top 3 записи по updated_at>
```

Лимит: 300 токенов. Только факты, без инструкций.

### MCP инструменты

| Инструмент | Назначение |
|------------|-----------|
| `recall` | Семантический поиск по памяти |
| `search_code` | Поиск по индексу кодовой базы |
| `request_validation` | Роутер запрашивает подтверждение у агента |

### `request_validation` — схема

```typescript
// input от роутера
type ValidationRequest = {
  proposed_text: string        // что роутер хочет запомнить
  proposed_status: Status      // статус который роутер предлагает
  similar_entry: string | null // существующая запись в Qdrant если найдена
  question: string             // конкретный вопрос роутера
}

// ответ агента
type ValidationResponse = {
  confirmed: boolean
  corrected_status?: Status    // если агент корректирует
  skip: boolean                // если нерелевантно
}
```

Вызывается только при confidence роутера между 0.5 и 0.75.
Выше 0.75 — роутер пишет напрямую. Ниже 0.5 — отбрасывает.

---

## hook-recall — UserPromptSubmit

### Вход

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/path/to/project",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "текст запроса пользователя"
}
```

### Алгоритм

```
1. Прочитать prompt из stdin
2. Вычислить embedding(prompt) через configured provider
3. ANN поиск в Qdrant: топ 5 записей по косинусному сходству
4. Отфильтровать: только confidence > 0.6
5. Приоритизировать: in_progress и open_question > resolved
6. Сформировать systemMessage:
   - если найдено: "Relevant memory:\n[записи со статусами]"
   - если не найдено: "No prior context found. This is new territory."
7. Вывести в stdout: { "systemMessage": "..." }
```

Лимит systemMessage: 500 токенов.
Всегда завершается с exit code 0 — никогда не блокирует запрос.

---

## hook-remember — Stop / SessionEnd

### Вход

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/path/to/project",
  "hook_event_name": "Stop",
  "stop_hook_active": false
}
```

### Алгоритм

```
1. Прочитать transcript_path
2. Извлечь последние N токенов (sliding window, default 2000)
   — не весь транскрипт, только свежий срез
3. Определить тип сессии:
   - headless: stop_hook_active = true
   - editing: Write/Edit/Bash tool calls в транскрипте
   - multi_agent: SubagentStop events в транскрипте
   - planning: по умолчанию
4. Передать окно в LLM роутер
5. Роутер возвращает список операций: [{ op, text, status, confidence }]
6. Для каждой операции:
   a. Вычислить embedding(text)
   b. Поиск в Qdrant: ближайшая запись (порог cosine > 0.88)
   c. Если найдена и confidence > threshold: обновить статус
   d. Если не найдена: создать новую запись
7. Записать все изменения в Qdrant
```

Пороги confidence по типу сессии:

| Тип сессии | Порог записи |
|------------|-------------|
| planning | 0.75 |
| editing | 0.75 |
| headless | 0.85 |
| multi_agent | 0.80 |

Всегда завершается с exit code 0. Асинхронный — не блокирует Claude Code.

---

## LLM роутер

### Назначение

Получает срез транскрипта → возвращает список операций с памятью.
Не читает весь транскрипт — только sliding window последних N токенов.

### Конфигурация провайдера

```json
{
  "router": {
    "provider": "ollama",
    "model": "gemma4",
    "fallback": {
      "provider": "gemini",
      "model": "gemini-flash"
    }
  }
}
```

Поддерживаемые провайдеры: `ollama` | `anthropic` | `openai` | `gemini`

### Промпт роутера

```
You are a memory extraction system for an AI coding agent.
Analyze this conversation excerpt and extract facts, decisions,
and open questions worth persisting across sessions.

For each item output JSON: { "text": "...", "status": "...", "confidence": 0.0-1.0 }
Status must be one of: in_progress, resolved, open_question, hypothesis
Only include items with confidence > 0.6.
Output a JSON array only. No explanation. No markdown.
```

При недоступности провайдера: пропустить запись в Qdrant, залогировать предупреждение,
завершить с exit 0. Недоступность роутера не блокирует работу агента.

---

## Классификатор статуса (без LLM)

Используется как быстрая проверка перед вызовом роутера.
Работает через косинусное сходство с шаблонными фразами.

### Шаблонные фразы

```typescript
const templates = {
  in_progress: [
    "working on", "implementing", "trying to", "need to",
    "в работе", "реализую", "нужно сделать", "работаем над",
  ],
  resolved: [
    "done", "finished", "decided", "confirmed", "works",
    "готово", "решено", "работает", "закончили", "договорились",
  ],
  open_question: [
    "unclear", "how do we", "not sure", "question",
    "непонятно", "как сделать", "вопрос", "нужно разобраться",
  ],
  hypothesis: [
    "maybe", "what if", "could try", "idea",
    "может быть", "что если", "попробовать", "идея",
  ],
}
```

Эмбеддинги шаблонов вычисляются при старте и кэшируются.
Классификация = поиск ближайшего шаблона по косинусному сходству.
Языконезависимо — работает через семантику, не через ключевые слова.

---

## Типы сессий

### planning
Доминируют текстовые обмены без изменений файлов.
hook-remember фокусируется на решениях, гипотезах, открытых вопросах.
SessionEnd хук — все `in_progress` записи сессии остаются `in_progress`.

### editing
Наличие Write / Edit / Bash tool calls в транскрипте.
hook-remember дополнительно фиксирует какие файлы изменялись.
PostToolUse может использоваться как дополнительная точка записи.

### headless
`stop_hook_active: true` в hook input, или отсутствие UserPromptSubmit событий.
Роутер не может вызвать `request_validation` — агент недоступен для диалога.
Повышенный порог confidence для всех записей.
Все решения логируются в `.memory-headless.log`.

### multi_agent
SubagentStop события в транскрипте.
Каждый агент пишет в коллекцию `memory_agents` с полем `agent_id`.
Главный агент при `hook-recall` читает из обеих коллекций: `memory` и `memory_agents`.
Конфликты (противоречивые статусы от разных агентов) передаются на валидацию.

---

## Конфигурация — `.memory.json`

```json
{
  "project": "local-rag",
  "qdrant": {
    "url": "http://localhost:6333",
    "collection": "memory"
  },
  "embedding": {
    "provider": "ollama",
    "model": "nomic-embed-text",
    "dimensions": 768
  },
  "router": {
    "provider": "ollama",
    "model": "gemma4",
    "fallback": null
  },
  "recall": {
    "top_k": 5,
    "min_confidence": 0.6,
    "max_tokens": 500
  },
  "remember": {
    "window_tokens": 2000,
    "similarity_threshold": 0.88
  }
}
```

---

## Регистрация хуков — `local-rag init`

Команда `npx @13w/local-rag init` обновляет `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "npx @13w/local-rag hook-recall --config .memory.json"
      }]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "npx @13w/local-rag hook-remember --config .memory.json"
      }]
    }],
    "SessionEnd": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "npx @13w/local-rag hook-remember --config .memory.json --trigger session_end"
      }]
    }]
  }
}
```

Мерджится с существующим `.claude/settings.json` — не перезаписывает другие хуки.

---

## Dashboard

Существующий HTTP дашборд (`local-rag serve`) расширяется вкладкой **Memory**:

- Счётчики по статусам: in_progress / resolved / open_question / hypothesis
- Последние 10 записей отсортированные по `updated_at` с badge статуса и confidence
- История сессий: session_id, тип сессии, количество записей
- Поиск: семантический поиск по памяти в реальном времени

Read-only. Без редактирования из интерфейса.

---

## Гарантии и ограничения

| Гарантия | Описание |
|----------|----------|
| Неблокирующий | Любой сбой в hook-recall или hook-remember завершается exit 0 |
| Приватность | Содержимое файлов не передаётся внешним провайдерам |
| Идемпотентность | Повторный запуск hook-remember не создаёт дубли |
| Деградация | При недоступности Qdrant или роутера система продолжает работать без памяти |

| Ограничение | Описание |
|------------|----------|
| Качество памяти | Зависит от качества роутера и размера sliding window |
| Latency | hook-recall добавляет ~100-500ms к каждому запросу пользователя |
| Слабое железо | Ollama с Gemma4 требует минимум 8GB RAM |
