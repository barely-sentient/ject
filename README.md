# Ject

A JSON compilation utility that makes JSON files modular, composable, and environment-aware.

Ject parses JSON documents and recursively resolves **directives** — special node markers like `@require`, `@var`, `@env`, and `@default` — into their resolved values. This lets you split large JSON schemas across files, inject environment variables, reference shared defaults, and compose complex configurations from small, reusable pieces.

## Installation

```bash
npm install json-ject
```

## Quick Start

```ts
import { parseFromString, parseFromUri } from "json-ject";

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
import { parseFromString, Directive } from "json-ject";

const upperDirective: Directive<string, string> = {
    targetNodeName: "@upper",
    transform: async (value, jectOptions, resolve) => value.toUpperCase()
};

const result = await parseFromString(
    JSON.stringify({ name: { "@upper": "hello" } }),
    { directives: [upperDirective] }
);
// { name: "HELLO" }
```

Directives now receive the current `JectOptions` as their second argument — use it to access `variables`, `customFileLoader` / `customUrlLoader`, or any other options passed to `parseFromString` / `parseFromUri`. The optional third argument `resolve` recursively resolves a node through the full directive pipeline (useful for directives like `@default`).

```ts
const captureDirective: Directive<string, string> = {
    targetNodeName: "@capture",
    transform: async (value, jectOptions, resolve) => {
        console.log(jectOptions.variables); // { $userId: 12 }
        return value;
    }
};
```

## Custom Loaders

By default `@require` and `parseFromUri` load files from the filesystem in Node (`fs/promises`) and via `fetch` in browsers. You can override this with an in-memory or virtual loader — ideal for tests, virtual file systems, or custom caching.

Loaders are supplied through `JectOptions` and automatically propagated to every nested `@require`.

| Loader | Environment | Replaces |
|---|---|---|
| `customFileLoader` | Node.js | `fs.access` + `fs.readFile` |
| `customUrlLoader` | Browser / `fetch` | `fetch(url).json()` |

When a loader is set it **completely bypasses** the default mechanism — the path/URL is passed straight to your function.

### `customFileLoader` (Node)

```ts
import { parseFromString, parseFromUri } from "json-ject";

// In-memory virtual filesystem
const virtualFs = new Map<string, object>([
    ["base.json", { host: "localhost", port: 3000 }],
    ["prod.json", { host: "prod.example.com" }],
]);

const loader = async (path: string) => virtualFs.get(path);

// With parseFromString + @require
const result = await parseFromString(JSON.stringify({
    config: { "@require": ["base.json", "prod.json"] }
}), {
    customFileLoader: loader
});
// { config: { host: "prod.example.com", port: 3000 } }

// With parseFromUri — the entry file itself is loaded via the custom loader
const config = await parseFromUri("base.json", { customFileLoader: loader });
// { host: "localhost", port: 3000 }

// Nested @require also uses the same loader, and its result is
// recursively resolved (so @var / @env inside still work)
const withVars = await parseFromString(JSON.stringify({
    data: { "@require": "with-directives.json" }
}), {
    variables: { $greeting: "hi" },
    customFileLoader: async () => ({ nested: { "@var": "$greeting" } })
});
// { data: { nested: "hi" } }
```

Return `undefined` to signal “not found” — for a single `@require` the node becomes `undefined`, for an array of paths the whole `@require` resolves to `undefined` (mirroring filesystem `ENOENT` handling).

```ts
const result = await parseFromString(JSON.stringify({
    data: { "@require": "missing.json" }
}), {
    customFileLoader: async () => undefined
});
// { data: undefined }
```

### `customUrlLoader` (Browser)

Used when Ject detects a non-Node environment (`process.versions.node` absent). Supply it the same way:

```ts
const result = await parseFromString(JSON.stringify({
    data: { "@require": "https://example.com/data.json" }
}), {
    customUrlLoader: async (url) => {
        const cached = await myCache.match(url);
        if (cached) return cached.json();
        const res = await fetch(url);
        return res.json();
    }
});

// parseFromUri also respects it
const remote = await parseFromUri("https://example.com/entry.json", {
    customUrlLoader: async (url) => ({ fromUrl: true, url })
});
```

In Node tests you can force the browser branch (as the test suite does) or simply use `customFileLoader` for all Node cases. Custom directives can also consume the loaders directly:

```ts
const loaderDirective: Directive<string, unknown> = {
    targetNodeName: "@loader",
    transform: async (value, jectOptions) => {
        return jectOptions.customFileLoader?.(value) ?? value;
    }
};
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
| `customFileLoader` | `(path: string) => Promise<object \| undefined>` | `undefined` | Override filesystem loading in Node — called for every `@require` and for `parseFromUri` entry file |
| `customUrlLoader` | `(url: string) => Promise<object \| undefined>` | `undefined` | Override `fetch` loading in browsers — called for every `@require` and for `parseFromUri` entry URL |

Every `Directive.transform` receives `JectOptions` as its second argument: `transform(value, jectOptions, resolve?)`.

## Development

```bash
npm install
npm run build
npm test
```
