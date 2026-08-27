import { parseFromString, parseFromUri } from "../index.js";
import { envDirective } from "../directives/env.js";
import { defaultDirective } from "../directives/default.js";
import { requireDirective } from "../directives/require.js";
import { createVariablesDirective } from "../directives/variable.js";
import { Directive } from "../directives/types.js";
import { resolve, dirname } from "path";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";

describe("@env", () => {
    const ENV_KEY = "__JECT_TEST_ENV_VAR__";

    afterEach(() => {
        delete process.env[ENV_KEY];
    });

    it("resolves an environment variable that exists", () => {
        process.env[ENV_KEY] = "hello";
        const directive = envDirective as Directive<string>;
        return expect(directive.transform(ENV_KEY)).resolves.toBe("hello");
    });

    it("returns undefined for a missing environment variable", () => {
        const directive = envDirective as Directive<string>;
        return expect(directive.transform(ENV_KEY)).resolves.toBeUndefined();
    });

    it("has correct targetNodeName", () => {
        expect(envDirective.targetNodeName).toBe("@env");
    });
});

describe("@var", () => {
    it("resolves a defined variable", () => {
        const directive = createVariablesDirective({ foo: 42 });
        return expect(directive.transform("foo")).resolves.toBe(42);
    });

    it("returns undefined for an undefined variable", () => {
        const spy = jest.spyOn(console, "warn").mockImplementation();
        const directive = createVariablesDirective({});
        return expect(directive.transform("missing")).resolves.toBeUndefined().then(() => {
            spy.mockRestore();
        });
    });

    it("has correct targetNodeName", () => {
        const directive = createVariablesDirective({});
        expect(directive.targetNodeName).toBe("@var");
    });
});

describe("@default", () => {
    it("has correct targetNodeName", () => {
        expect(defaultDirective.targetNodeName).toBe("@default");
    });

    it("returns value when defined", () => {
        const directive = defaultDirective as Directive<Record<string, unknown>>;
        return expect(directive.transform({ value: "exists", default: "fallback" })).resolves.toBe("exists");
    });

    it("returns default when value is undefined", () => {
        const directive = defaultDirective as Directive<Record<string, unknown>>;
        return expect(directive.transform({ value: undefined, default: "fallback" })).resolves.toBe("fallback");
    });

    it("returns default when value key is absent and resolve returns undefined", async () => {
        const directive = defaultDirective as Directive<Record<string, unknown>>;
        const resolve = jest.fn(async () => undefined);
        const result = await directive.transform(
            { "@env": "NONexistent", "default": 9999 },
            resolve
        );
        expect(result).toBe(9999);
    });

    it("resolves nested directive via resolve callback", async () => {
        process.env.__JECT_DEFAULT_TEST__ = "resolved";
        const directive = defaultDirective as Directive<Record<string, unknown>>;
        const resolve = jest.fn(async (node: unknown) => {
            const obj = node as Record<string, unknown>;
            if ("@env" in obj) {
                return process.env[obj["@env"] as string];
            }
            return node;
        });
        const result = await directive.transform(
            { "@env": "__JECT_DEFAULT_TEST__", "default": 0 },
            resolve
        );
        expect(result).toBe("resolved");
        delete process.env.__JECT_DEFAULT_TEST__;
    });
});

describe("@require", () => {
    it("has correct targetNodeName", () => {
        expect(requireDirective.targetNodeName).toBe("@require");
    });
});

describe("parseFromString", () => {
    it("returns null for null JSON", async () => {
        const result = await parseFromString("null");
        expect(result).toBeNull();
    });

    it("throws on invalid JSON", async () => {
        await expect(parseFromString("not json")).rejects.toThrow(SyntaxError);
    });

    it("passes through plain objects unchanged", async () => {
        const result = await parseFromString(JSON.stringify({ a: 1, b: "two" }));
        expect(result).toEqual({ a: 1, b: "two" });
    });

    it("passes through arrays unchanged", async () => {
        const result = await parseFromString(JSON.stringify([1, 2, 3]));
        expect(result).toEqual([1, 2, 3]);
    });

    it("resolves @var directives", async () => {
        const result = await parseFromString(
            JSON.stringify({ port: { "@var": "$port" } }),
            { variables: { $port: 3000 } }
        );
        expect(result).toEqual({ port: 3000 });
    });

    it("resolves @env directives", async () => {
        process.env.__JECT_PARSE_TEST__ = "env-value";
        const result = await parseFromString(
            JSON.stringify({ val: { "@env": "__JECT_PARSE_TEST__" } })
        );
        expect(result).toEqual({ val: "env-value" });
        delete process.env.__JECT_PARSE_TEST__;
    });

    it("resolves @default with value present", async () => {
        const result = await parseFromString(
            JSON.stringify({
                port: { "@default": { value: 8080, default: 3000 } },
            })
        );
        expect(result).toEqual({ port: 8080 });
    });

    it("resolves @default falling back to default", async () => {
        const result = await parseFromString(
            JSON.stringify({
                port: { "@default": { value: undefined, default: 3000 } },
            })
        );
        expect(result).toEqual({ port: 3000 });
    });

    it("resolves @default with nested @env (shorthand)", async () => {
        process.env.__JECT_DEFAULT_SHORTHAND__ = "shorthand-val";
        const result = await parseFromString(
            JSON.stringify({
                port: {
                    "@default": {
                        "@env": "__JECT_DEFAULT_SHORTHAND__",
                        default: 3000,
                    },
                },
            })
        );
        expect(result).toEqual({ port: "shorthand-val" });
        delete process.env.__JECT_DEFAULT_SHORTHAND__;
    });

    it("resolves @default with nested @env falling back to default", async () => {
        const result = await parseFromString(
            JSON.stringify({
                port: {
                    "@default": {
                        "@env": "__NONEXISTENT_VAR__",
                        default: 3000,
                    },
                },
            })
        );
        expect(result).toEqual({ port: 3000 });
    });

    it("resolves directives in arrays", async () => {
        const result = await parseFromString(
            JSON.stringify({
                ports: [{ "@var": "$a" }, { "@var": "$b" }],
            }),
            { variables: { $a: 1, $b: 2 } }
        );
        expect(result).toEqual({ ports: [1, 2] });
    });

    it("resolves deeply nested directives", async () => {
        const result = await parseFromString(
            JSON.stringify({
                level1: {
                    level2: {
                        level3: { "@var": "$deep" },
                    },
                },
            }),
            { variables: { $deep: "found" } }
        );
        expect(result).toEqual({
            level1: { level2: { level3: "found" } },
        });
    });

    it("supports custom directives", async () => {
        const upperDirective: Directive<string, string> = {
            targetNodeName: "@upper",
            transform: async (value: string) => value.toUpperCase(),
        };

        const result = await parseFromString(
            JSON.stringify({ name: { "@upper": "hello" } }),
            { directives: [upperDirective as Directive<unknown>] }
        );
        expect(result).toEqual({ name: "HELLO" });
    });
});

describe("parseFromUri", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(resolve(tmpdir(), "ject-test-"));
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    const writeJson = (name: string, data: unknown) => {
        const path = resolve(tmpDir, name);
        writeFileSync(path, JSON.stringify(data), "utf-8");
        return path;
    };

    it("loads and resolves a JSON file", async () => {
        const filePath = writeJson("simple.json", {
            port: { "@var": "$port" },
        });
        const result = await parseFromUri(filePath, {
            variables: { $port: 4000 },
        });
        expect(result).toEqual({ port: 4000 });
    });

    it("resolves @env in a file", async () => {
        process.env.__JECT_FILE_TEST__ = "from-file";
        const filePath = writeJson("env.json", {
            val: { "@env": "__JECT_FILE_TEST__" },
        });
        const result = await parseFromUri(filePath);
        expect(result).toEqual({ val: "from-file" });
        delete process.env.__JECT_FILE_TEST__;
    });

    it("resolves @require within a file (recursion)", async () => {
        writeJson("inner.json", {
            name: { "@var": "$name" },
        });
        const filePath = writeJson("outer.json", {
            user: { "@require": resolve(tmpDir, "inner.json") },
        });
        const result = await parseFromUri(filePath, {
            variables: { $name: "Alice" },
        });
        expect(result).toEqual({ user: { name: "Alice" } });
    });

    it("returns undefined for nonexistent file", async () => {
        const result = await parseFromUri(resolve(tmpDir, "nope.json"));
        expect(result).toBeUndefined();
    });

    it("resolves @default with @env from a file", async () => {
        process.env.__JECT_FILE_DEFAULT__ = "file-env";
        const filePath = writeJson("default.json", {
            port: {
                "@default": {
                    "@env": "__JECT_FILE_DEFAULT__",
                    default: 3000,
                },
            },
        });
        const result = await parseFromUri(filePath);
        expect(result).toEqual({ port: "file-env" });
        delete process.env.__JECT_FILE_DEFAULT__;
    });

    it("merges multiple @require'd files", async () => {
        writeJson("a.json", { x: 1, y: 1 });
        writeJson("b.json", { y: 2, z: 3 });
        const filePath = writeJson("merged.json", {
            data: {
                "@require": [
                    resolve(tmpDir, "a.json"),
                    resolve(tmpDir, "b.json"),
                ],
            },
        });
        const result = await parseFromUri(filePath);
        expect(result).toEqual({ data: { x: 1, y: 2, z: 3 } });
    });
});
