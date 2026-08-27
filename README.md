# Ject

A JSON compilation utility that makes JSON files modular, composable, and environment-aware.

Ject parses JSON documents and recursively resolves **directives** — special node markers like `@require`, `@var`, `@env`, and `@default` — into their resolved values. This lets you split large JSON schemas across files, inject environment variables, reference shared defaults, and compose complex configurations from small, reusable pieces.

## Installation

```bash
npm install ject
```

## Quick Start

```ts
import { parseFromString, parseFromUri } from "ject";

// Parse from a string
const result = await parseFromString(`{
    "port": { "@env": "PORT" },
    "host": { "@default": { "@env": "HOST", "default": "localhost" } }
}`, {
    variables: { "$env": "production" }
});

// Or parse directly from a file
const config = await parseFromUri("./schemas/config.json", {
    variables: { "$appName": "My App" }
});
```

## Directives

Directives are special JSON property keys that trigger transformations during parsing. Ject ships with four built-in directives:

### `@require`

Loads and merges one or more external JSON files.

```json
{
    "user": { "@require": "./schemas/user.json" },
    "config": {
        "@require": [
            "./schemas/base.json",
            "./schemas/production.json"
        ]
    }
}
```

When given an array of paths, files are loaded concurrently and merged left-to-right. Later files override earlier ones.

Loaded documents are recursively resolved, so any directives within them are processed automatically.

### `@env`

Reads an environment variable from `process.env`.

```json
{
    "port": { "@env": "PORT" },
    "databaseUrl": { "@env": "DATABASE_URL" }
}
```

Returns the variable's string value, or `undefined` if not set.

### `@default`

Provides a fallback value when another value is `undefined`.

```json
{
    "port": {
        "@default": {
            "value": { "@env": "PORT" },
            "default": 3000
        }
    }
}
```

If `PORT` is set, its value is used. Otherwise, `3000` is returned.

`@default` supports a **shorthand** — use any directive key directly instead of wrapping it in `value`:

```json
{
    "port": {
        "@default": {
            "@env": "PORT",
            "default": 3000
        }
    }
}
```

### `@var`

Injects a named variable from the `variables` option.

```json
{
    "userId": { "@var": "$userId" },
    "roleName": { "@var": "$roleName" }
}
```

```ts
const result = await parseFromString(json, {
    variables: {
        $userId: 12,
        $roleName: "admin"
    }
});
```

## Composing Directives

Directives compose naturally — nested directives are resolved recursively:

```json
{
    "dbHost": {
        "@default": {
            "@require": "./schemas/defaults.json",
            "default": { "@env": "DB_HOST" }
        }
    }
}
```

## Custom Directives

You can register your own directives:

```ts
import { parseFromString, Directive } from "ject";

const upperDirective: Directive<string, string> = {
    targetNodeName: "@upper",
    transform: async (value) => value.toUpperCase()
};

const result = await parseFromString(
    JSON.stringify({ name: { "@upper": "hello" } }),
    { directives: [upperDirective] }
);
// { name: "HELLO" }
```

## API

### `parseFromString(source, options?)`

Parses and resolves a JSON string.

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `string` | A valid JSON string |
| `options` | `JectOptions` | Optional configuration |

Returns `Promise<T | undefined>`.

### `parseFromUri(path, options?)`

Loads, parses, and resolves a JSON file from a filesystem path or URL.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Filesystem path or URL |
| `options` | `JectOptions` | Optional configuration |

Returns `Promise<T | undefined>`.

### `JectOptions`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `variables` | `Record<string, unknown>` | `{}` | Values available to `@var` |
| `directives` | `Directive[]` | `[]` | Custom directives to register |

## Development

```bash
npm install
npm run build
npm test
```
