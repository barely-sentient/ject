import { parseFromString, parseFromUri } from "../index.js";
import { envDirective } from "../directives/env.js";
import { defaultDirective } from "../directives/default.js";
import { requireDirective, LoadJson } from "../directives/require.js";
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
        return expect(directive.transform(ENV_KEY, {})).resolves.toBe("hello");
    });

    it("returns undefined for a missing environment variable", () => {
        const directive = envDirective as Directive<string>;
        return expect(directive.transform(ENV_KEY, {})).resolves.toBeUndefined();
    });

    it("has correct targetNodeName", () => {
        expect(envDirective.targetNodeName).toBe("@env");
    });
});

describe("@var", () => {
    it("resolves a defined variable", () => {
        const directive = createVariablesDirective({ foo: 42 });
        return expect(directive.transform("foo", {})).resolves.toBe(42);
    });

    it("returns undefined for an undefined variable", () => {
        const spy = jest.spyOn(console, "warn").mockImplementation();
        const directive = createVariablesDirective({});
        return expect(directive.transform("missing", {})).resolves.toBeUndefined().then(() => {
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
        return expect(directive.transform({ value: "exists", default: "fallback" }, {})).resolves.toBe("exists");
    });

    it("returns default when value is undefined", () => {
        const directive = defaultDirective as Directive<Record<string, unknown>>;
        return expect(directive.transform({ value: undefined, default: "fallback" }, {})).resolves.toBe("fallback");
    });

    it("returns default when value key is absent and resolve returns undefined", async () => {
        const directive = defaultDirective as Directive<Record<string, unknown>>;
        const resolve = jest.fn(async () => undefined);
        const result = await directive.transform(
            { "@env": "NONexistent", "default": 9999 },
            {},
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
            {},
            resolve
        );
        expect(result).toBe("resolved");
        delete process.env.__JECT_DEFAULT_TEST__;
    });

    it("receives jectOptions as second argument", async () => {
        const directive = defaultDirective as Directive<Record<string, unknown>>;
        const jectOptions = { variables: { foo: "bar" } };
        // when value is present, resolve is not invoked; we just verify options are accepted
        const result = await directive.transform({ value: "present", default: "fallback" }, jectOptions);
        expect(result).toBe("present");
    });

    it("forwards jectOptions and uses resolve for shorthand syntax", async () => {
        const directive = defaultDirective as Directive<Record<string, unknown>>;
        const jectOptions = { variables: { x: 1 } };
        const resolve = jest.fn(async (node: unknown) => "resolved-via-shorthand");
        const result = await directive.transform(
            { "@env": "SOME_VAR", "default": "fallback" },
            jectOptions,
            resolve
        );
        expect(resolve).toHaveBeenCalledWith({ "@env": "SOME_VAR" });
        expect(result).toBe("resolved-via-shorthand");
    });
});

describe("@require", () => {
    it("has correct targetNodeName", () => {
        expect(requireDirective.targetNodeName).toBe("@require");
    });

    it("receives jectOptions as second argument", async () => {
        // verify signature accepts jectOptions without throwing (file may not exist, returns undefined)
        const result = await (requireDirective as Directive<string | string[]>).transform(
            "nonexistent.json",
            { variables: { a: 1 } }
        );
        expect(result).toBeUndefined();
    });

    describe("with customFileLoader", () => {
        it("uses customFileLoader for a single path", async () => {
            const mock = jest.fn(async (path: string) => ({ mocked: true, path }));
            const result = await (requireDirective as Directive<string | string[]>).transform(
                "virtual.json",
                { customFileLoader: mock }
            );
            expect(mock).toHaveBeenCalledWith("virtual.json");
            expect(mock).toHaveBeenCalledTimes(1);
            expect(result).toEqual({ mocked: true, path: "virtual.json" });
        });

        it("uses customFileLoader for each path in an array and merges results", async () => {
            const mock = jest.fn(async (path: string) => {
                if (path === "a.json") return { x: 1, y: 1 };
                if (path === "b.json") return { y: 2, z: 3 };
                return undefined;
            });
            const result = await (requireDirective as Directive<string | string[]>).transform(
                ["a.json", "b.json"],
                { customFileLoader: mock }
            );
            expect(mock).toHaveBeenCalledWith("a.json");
            expect(mock).toHaveBeenCalledWith("b.json");
            expect(result).toEqual({ x: 1, y: 2, z: 3 });
        });

        it("returns undefined if any customFileLoader result is undefined when loading multiple paths", async () => {
            const mock = jest.fn(async (path: string) => {
                if (path === "exists.json") return { ok: true };
                return undefined;
            });
            const result = await (requireDirective as Directive<string | string[]>).transform(
                ["exists.json", "missing.json"],
                { customFileLoader: mock }
            );
            expect(result).toBeUndefined();
        });

        it("does not fall back to filesystem when customFileLoader is provided", async () => {
            // even though file does not exist on disk, mock returns data
            const mock = jest.fn(async () => ({ fromMock: true }));
            const result = await (requireDirective as Directive<string | string[]>).transform(
                "no-real-file.json",
                { customFileLoader: mock }
            );
            expect(mock).toHaveBeenCalled();
            expect(result).toEqual({ fromMock: true });
        });

        it("forwards the same jectOptions instance to customFileLoader", async () => {
            const jectOptions = { variables: { a: 1 }, customFileLoader: jest.fn(async () => ({ hi: true })) };
            // re-assign mock to capture call and assert options reference
            const mock = jest.fn(async (path: string) => {
                expect(path).toBe("check.json");
                return { hi: true };
            });
            jectOptions.customFileLoader = mock;
            await (requireDirective as Directive<string | string[]>).transform("check.json", jectOptions);
            expect(mock).toHaveBeenCalledWith("check.json");
        });
    });

    describe("with customUrlLoader", () => {
        // customUrlLoader is only used in the WebLoader branch (non-Node).
        // We verify its behaviour indirectly via LoadJson mocking Node detection.

        it("LoadJson delegates to customUrlLoader when in non-Node environment", async () => {
            const mockUrlLoader = jest.fn(async (url: string) => ({ fromUrl: true, url }));
            const originalVersions = (process as any).versions;
            // force non-Node by removing node version
            const originalDescriptor = Object.getOwnPropertyDescriptor(process, "versions");
            try {
                Object.defineProperty(process, "versions", {
                    value: {},
                    configurable: true,
                    writable: true,
                });
                const result = await LoadJson("https://example.com/data.json", {
                    customUrlLoader: mockUrlLoader,
                });
                expect(mockUrlLoader).toHaveBeenCalledWith("https://example.com/data.json");
                expect(result).toEqual({ fromUrl: true, url: "https://example.com/data.json" });
            } finally {
                if (originalDescriptor) {
                    Object.defineProperty(process, "versions", originalDescriptor);
                } else {
                    (process as any).versions = originalVersions;
                }
            }
        });

        it("LoadJson prefers customUrlLoader over fetch in non-Node environment", async () => {
            const mockUrlLoader = jest.fn(async () => ({ mockedUrl: true }));
            const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => {
                throw new Error("fetch should not be called when customUrlLoader is present");
            });
            const originalVersions = (process as any).versions;
            const originalDescriptor = Object.getOwnPropertyDescriptor(process, "versions");
            try {
                Object.defineProperty(process, "versions", {
                    value: undefined,
                    configurable: true,
                    writable: true,
                });
                const result = await LoadJson("https://example.com/other.json", {
                    customUrlLoader: mockUrlLoader,
                });
                expect(mockUrlLoader).toHaveBeenCalledTimes(1);
                expect(result).toEqual({ mockedUrl: true });
                expect(fetchSpy).not.toHaveBeenCalled();
            } finally {
                fetchSpy.mockRestore();
                if (originalDescriptor) {
                    Object.defineProperty(process, "versions", originalDescriptor);
                } else {
                    (process as any).versions = originalVersions;
                }
            }
        });

        it("requireDirective uses customUrlLoader via LoadJson in non-Node environment", async () => {
            const mockUrlLoader = jest.fn(async (url: string) => ({ urlContent: true }));
            const originalDescriptor = Object.getOwnPropertyDescriptor(process, "versions");
            try {
                Object.defineProperty(process, "versions", {
                    value: null,
                    configurable: true,
                    writable: true,
                });
                const result = await (requireDirective as Directive<string | string[]>).transform(
                    "https://example.com/remote.json",
                    { customUrlLoader: mockUrlLoader }
                );
                expect(mockUrlLoader).toHaveBeenCalledWith("https://example.com/remote.json");
                expect(result).toEqual({ urlContent: true });
            } finally {
                if (originalDescriptor) Object.defineProperty(process, "versions", originalDescriptor);
            }
        });
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
            transform: async (value: string, _jectOptions) => value.toUpperCase(),
        };

        const result = await parseFromString(
            JSON.stringify({ name: { "@upper": "hello" } }),
            { directives: [upperDirective as Directive<unknown>] }
        );
        expect(result).toEqual({ name: "HELLO" });
    });

    it("passes jectOptions to custom directive transform", async () => {
        let capturedOptions: unknown = null;
        const captureDirective: Directive<string, string> = {
            targetNodeName: "@capture",
            transform: async (value: string, jectOptions) => {
                capturedOptions = jectOptions;
                return value;
            },
        };

        const result = await parseFromString(
            JSON.stringify({ v: { "@capture": "hello" } }),
            {
                variables: { $port: 3000 },
                directives: [captureDirective as Directive<unknown>],
            }
        );
        expect(result).toEqual({ v: "hello" });
        expect(capturedOptions).toEqual(expect.objectContaining({ variables: { $port: 3000 } }));
    });

    it("passes jectOptions including customFileLoader to custom directive", async () => {
        const mockLoader = jest.fn(async (_path: string) => ({ loaded: true }));
        const loaderDirective: Directive<string, unknown> = {
            targetNodeName: "@loader",
            transform: async (value: string, jectOptions) => {
                if (jectOptions.customFileLoader) {
                    return jectOptions.customFileLoader(value);
                }
                return value;
            },
        };

        const result = await parseFromString(
            JSON.stringify({ data: { "@loader": "some/path.json" } }),
            {
                customFileLoader: mockLoader,
                directives: [loaderDirective as Directive<unknown>],
            }
        );
        expect(mockLoader).toHaveBeenCalledWith("some/path.json");
        expect(result).toEqual({ data: { loaded: true } });
    });

    it("passes jectOptions as second arg and resolve as third arg to transform", async () => {
        let receivedArgs: unknown[] = [];
        const spyDirective: Directive<Record<string, unknown>, unknown> = {
            targetNodeName: "@spy",
            resolveInput: ["value"],
            transform: async (input, jectOptions, resolve) => {
                receivedArgs = [input, jectOptions, resolve];
                // ensure resolve is a function when provided
                expect(typeof resolve).toBe("function");
                // use resolve to exercise nested directive handling
                if (resolve && input.value) {
                    return resolve(input.value);
                }
                return input.value;
            },
        };

        const result = await parseFromString(
            JSON.stringify({ out: { "@spy": { value: { "@var": "$x" } } } }),
            {
                variables: { $x: "resolved-x" },
                directives: [spyDirective as Directive<unknown>],
            }
        );
        expect(result).toEqual({ out: "resolved-x" });
        expect(receivedArgs[1]).toEqual(expect.objectContaining({ variables: { $x: "resolved-x" } }));
    });

    it("passes jectOptions object when only directives are supplied", async () => {
        let captured: unknown = null;
        const captureDirective: Directive<string, string> = {
            targetNodeName: "@captureEmpty",
            transform: async (value, jectOptions) => {
                captured = jectOptions;
                return value;
            },
        };
        await parseFromString(
            JSON.stringify({ v: { "@captureEmpty": "hi" } }),
            { directives: [captureDirective as Directive<unknown>] }
        );
        expect(captured).toEqual(expect.objectContaining({ directives: expect.arrayContaining([captureDirective as Directive<unknown>]) }));
    });

    describe("with customFileLoader and @require", () => {
        it("resolves @require via customFileLoader", async () => {
            const mock = jest.fn(async (path: string) => {
                expect(path).toBe("mocked.json");
                return { hello: "world" };
            });
            const result = await parseFromString(
                JSON.stringify({ data: { "@require": "mocked.json" } }),
                { customFileLoader: mock }
            );
            expect(result).toEqual({ data: { hello: "world" } });
            expect(mock).toHaveBeenCalledTimes(1);
        });

        it("merges multiple @require files via customFileLoader", async () => {
            const mock = jest.fn(async (path: string) => {
                if (path === "a.json") return { x: 1, y: 1 };
                if (path === "b.json") return { y: 2, z: 3 };
                return undefined;
            });
            const result = await parseFromString(
                JSON.stringify({ data: { "@require": ["a.json", "b.json"] } }),
                { customFileLoader: mock }
            );
            expect(result).toEqual({ data: { x: 1, y: 2, z: 3 } });
        });

        it("returns undefined when customFileLoader returns undefined for @require", async () => {
            const mock = jest.fn(async () => undefined);
            const result = await parseFromString(
                JSON.stringify({ data: { "@require": "missing.json" } }),
                { customFileLoader: mock }
            );
            // handleNode will recursively resolve undefined output to undefined
            expect(result).toEqual({ data: undefined });
        });

        it("resolves nested directives inside customFileLoader result and propagates jectOptions", async () => {
            const mock = jest.fn(async () => ({
                nested: { "@var": "$greeting" },
                envVal: { "@env": "__JECT_CUSTOM_LOADER_ENV__" },
            }));
            process.env.__JECT_CUSTOM_LOADER_ENV__ = "env-from-loader";
            const result = await parseFromString(
                JSON.stringify({ data: { "@require": "with-directives.json" } }),
                {
                    variables: { $greeting: "hi" },
                    customFileLoader: mock,
                }
            );
            expect(result).toEqual({ data: { nested: "hi", envVal: "env-from-loader" } });
            delete process.env.__JECT_CUSTOM_LOADER_ENV__;
        });

        it("uses customFileLoader for nested @require (recursion via transformOutput)", async () => {
            const mock = jest.fn(async (path: string) => {
                if (path === "outer.json") return { inner: { "@require": "inner.json" } };
                if (path === "inner.json") return { value: { "@var": "$x" } };
                return undefined;
            });
            const result = await parseFromString(
                JSON.stringify({ data: { "@require": "outer.json" } }),
                {
                    variables: { $x: "deep-value" },
                    customFileLoader: mock,
                }
            );
            // outer -> inner -> variable resolution
            expect(result).toEqual({ data: { inner: { value: "deep-value" } } });
            expect(mock).toHaveBeenCalledWith("outer.json");
            expect(mock).toHaveBeenCalledWith("inner.json");
        });

        it("prefers customFileLoader over real filesystem even when file exists", async () => {
            // create a real temp file, but mock should override
            const tmpDir = mkdtempSync(resolve(tmpdir(), "ject-custom-override-"));
            const realPath = resolve(tmpDir, "real.json");
            writeFileSync(realPath, JSON.stringify({ real: true }), "utf-8");
            const mock = jest.fn(async () => ({ mocked: true }));
            const result = await parseFromString(
                JSON.stringify({ data: { "@require": realPath } }),
                { customFileLoader: mock }
            );
            expect(mock).toHaveBeenCalledWith(realPath);
            expect(result).toEqual({ data: { mocked: true } });
            rmSync(tmpDir, { recursive: true, force: true });
        });
    });

    describe("with customUrlLoader and @require (browser simulation)", () => {
        let originalDescriptor: PropertyDescriptor | undefined;
        beforeEach(() => {
            originalDescriptor = Object.getOwnPropertyDescriptor(process, "versions");
            Object.defineProperty(process, "versions", {
                value: undefined,
                configurable: true,
                writable: true,
            });
        });
        afterEach(() => {
            if (originalDescriptor) Object.defineProperty(process, "versions", originalDescriptor);
        });

        it("resolves @require via customUrlLoader in non-Node env", async () => {
            const mockUrl = jest.fn(async (url: string) => ({ urlData: true, url }));
            const result = await parseFromString(
                JSON.stringify({ data: { "@require": "https://example.com/a.json" } }),
                { customUrlLoader: mockUrl }
            );
            expect(mockUrl).toHaveBeenCalledWith("https://example.com/a.json");
            expect(result).toEqual({ data: { urlData: true, url: "https://example.com/a.json" } });
        });

        it("merges multiple @require URLs via customUrlLoader", async () => {
            const mockUrl = jest.fn(async (url: string) => {
                if (url === "https://example.com/a.json") return { a: 1 };
                if (url === "https://example.com/b.json") return { b: 2 };
                return undefined;
            });
            const result = await parseFromString(
                JSON.stringify({ data: { "@require": ["https://example.com/a.json", "https://example.com/b.json"] } }),
                { customUrlLoader: mockUrl }
            );
            expect(result).toEqual({ data: { a: 1, b: 2 } });
        });
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

    it("passes jectOptions through @require to nested file resolution", async () => {
        writeJson("inner.json", {
            greeting: { "@var": "$greeting" },
        });
        const filePath = writeJson("outer.json", {
            data: { "@require": resolve(tmpDir, "inner.json") },
        });
        const result = await parseFromUri(filePath, {
            variables: { $greeting: "hello from require" },
        });
        expect(result).toEqual({ data: { greeting: "hello from require" } });
    });

    it("custom directive in file receives jectOptions via parseFromUri", async () => {
        let capturedOptions: unknown = null;
        const captureDirective: Directive<string, string> = {
            targetNodeName: "@captureUri",
            transform: async (value, jectOptions) => {
                capturedOptions = jectOptions;
                return `${value}-captured`;
            },
        };
        const filePath = writeJson("capture.json", {
            val: { "@captureUri": "test" },
        });
        const result = await parseFromUri(filePath, {
            variables: { $a: 1 },
            directives: [captureDirective as Directive<unknown>],
        });
        expect(result).toEqual({ val: "test-captured" });
        expect(capturedOptions).toEqual(expect.objectContaining({ variables: { $a: 1 } }));
    });

    describe("with customFileLoader", () => {
        it("uses customFileLoader for the initial parseFromUri load", async () => {
            const mock = jest.fn(async (path: string) => ({ fromCustom: true, path }));
            const result = await parseFromUri("virtual-entry.json", {
                customFileLoader: mock,
            });
            expect(mock).toHaveBeenCalledWith("virtual-entry.json");
            expect(result).toEqual({ fromCustom: true, path: "virtual-entry.json" });
        });

        it("resolves directives in file loaded via customFileLoader", async () => {
            const mock = jest.fn(async () => ({ val: { "@var": "$x" } }));
            const result = await parseFromUri("entry.json", {
                variables: { $x: 42 },
                customFileLoader: mock,
            });
            expect(result).toEqual({ val: 42 });
        });

        it("uses customFileLoader for nested @require inside parseFromUri file", async () => {
            const mock = jest.fn(async (path: string) => {
                if (path === "entry.json") return { data: { "@require": "inner.json" } };
                if (path === "inner.json") return { hello: "world", v: { "@var": "$v" } };
                return undefined;
            });
            const result = await parseFromUri("entry.json", {
                variables: { $v: 123 },
                customFileLoader: mock,
            });
            expect(mock).toHaveBeenCalledWith("entry.json");
            expect(mock).toHaveBeenCalledWith("inner.json");
            expect(result).toEqual({ data: { hello: "world", v: 123 } });
        });

        it("returns undefined when customFileLoader returns undefined for entry file", async () => {
            const mock = jest.fn(async () => undefined);
            const result = await parseFromUri("missing.json", {
                customFileLoader: mock,
            });
            expect(result).toBeUndefined();
        });
    });

    describe("with customUrlLoader (browser simulation)", () => {
        let originalDescriptor: PropertyDescriptor | undefined;
        beforeEach(() => {
            originalDescriptor = Object.getOwnPropertyDescriptor(process, "versions");
            Object.defineProperty(process, "versions", {
                value: undefined,
                configurable: true,
                writable: true,
            });
        });
        afterEach(() => {
            if (originalDescriptor) Object.defineProperty(process, "versions", originalDescriptor);
        });

        it("uses customUrlLoader for initial parseFromUri load", async () => {
            const mock = jest.fn(async (url: string) => ({ remote: true, url }));
            const result = await parseFromUri("https://example.com/entry.json", {
                customUrlLoader: mock,
            });
            expect(mock).toHaveBeenCalledWith("https://example.com/entry.json");
            expect(result).toEqual({ remote: true, url: "https://example.com/entry.json" });
        });

        it("uses customUrlLoader for nested @require", async () => {
            const mock = jest.fn(async (url: string) => {
                if (url === "https://example.com/entry.json") return { data: { "@require": "https://example.com/inner.json" } };
                if (url === "https://example.com/inner.json") return { ok: true };
                return undefined;
            });
            const result = await parseFromUri("https://example.com/entry.json", {
                customUrlLoader: mock,
            });
            expect(result).toEqual({ data: { ok: true } });
        });
    });
});

describe("LoadJson with custom loaders", () => {
    afterEach(() => jest.restoreAllMocks());

    it("FileLoader uses customFileLoader and bypasses filesystem", async () => {
        const mock = jest.fn(async () => ({ mocked: true }));
        // FileLoader checks customFileLoader before importing fs, so this should return mocked data
        // even though "any.json" does not exist on disk, and without triggering console.error
        const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        const result = await LoadJson("any.json", { customFileLoader: mock });
        expect(mock).toHaveBeenCalledWith("any.json");
        expect(result).toEqual({ mocked: true });
        expect(consoleSpy).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it("FileLoader falls back to fs when customFileLoader not provided (integration sanity)", async () => {
        const tmpDir = mkdtempSync(resolve(tmpdir(), "ject-loadjson-"));
        const filePath = resolve(tmpDir, "real.json");
        writeFileSync(filePath, JSON.stringify({ real: 1 }), "utf-8");
        const result = await LoadJson(filePath, {});
        expect(result).toEqual({ real: 1 });
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("WebLoader uses customUrlLoader and bypasses fetch", async () => {
        const mock = jest.fn(async () => ({ urlMocked: true }));
        const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => {
            throw new Error("should not be called");
        });
        const originalDescriptor = Object.getOwnPropertyDescriptor(process, "versions");
        try {
            Object.defineProperty(process, "versions", { value: {}, configurable: true, writable: true });
            const result = await LoadJson("https://example.com/x.json", { customUrlLoader: mock });
            expect(mock).toHaveBeenCalledWith("https://example.com/x.json");
            expect(result).toEqual({ urlMocked: true });
            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            fetchSpy.mockRestore();
            if (originalDescriptor) Object.defineProperty(process, "versions", originalDescriptor);
        }
    });

    it("WebLoader falls back to fetch when customUrlLoader not provided", async () => {
        const originalDescriptor = Object.getOwnPropertyDescriptor(process, "versions");
        const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async () => ({
            json: async () => ({ fetched: true }),
        } as Response));
        try {
            Object.defineProperty(process, "versions", { value: {}, configurable: true, writable: true });
            const result = await LoadJson("https://example.com/fallback.json", {});
            expect(fetchSpy).toHaveBeenCalledWith("https://example.com/fallback.json");
            expect(result).toEqual({ fetched: true });
        } finally {
            fetchSpy.mockRestore();
            if (originalDescriptor) Object.defineProperty(process, "versions", originalDescriptor);
        }
    });
});
