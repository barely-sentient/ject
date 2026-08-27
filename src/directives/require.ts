import { JectOptions } from "../parse.js";
import { Directive } from "./types.js";

/**
 * Represents an asynchronous function capable of loading and parsing a JSON
 * document from a resource identified by a path or URL.
 *
 * Implementations may resolve resources using different mechanisms depending
 * on the execution environment. For example, a Node.js implementation may
 * read directly from the filesystem, while a browser implementation may
 * retrieve the resource using the Fetch API.
 *
 * @param path - The path, URL, or other resource identifier used to locate
 * the JSON document.
 * @param jectOptions - Any options to pass to the loader
 *
 * @returns A promise that resolves to the parsed JSON object when the
 * resource can be successfully loaded and parsed; otherwise `undefined`.
 */
export type JsonLoader = (
    path: string,
    jectOptions: JectOptions
) => Promise<object | undefined>;

/**
 * Loads and parses a JSON document using the Fetch API.
 *
 * This implementation is intended for browser and other environments that
 * provide a compatible global `fetch` implementation. The supplied URL is
 * resolved according to the environment's normal URL resolution rules.
 *
 * Any network, HTTP, or JSON parsing failure is caught and reported to the
 * console. The loader returns `undefined` when the resource cannot be loaded
 * or parsed.
 *
 * @param url - The URL identifying the JSON resource to retrieve.
 * @param jectOptions - any additional options
 *
 * @returns A promise that resolves to the parsed JSON object, or `undefined`
 * if the resource could not be retrieved or parsed.
 */
const WebLoader: JsonLoader = async (
    url: string,
    jectOptions: JectOptions
): Promise<object | undefined> => {

    if (jectOptions.customUrlLoader) {
        return jectOptions.customUrlLoader(url)
    }

    try {
        const response = await fetch(url);
        const result = await response.json();

        return result;
    }
    catch (e) {
        console.error("JECT", { e, url });
    }

    return undefined;
};

/**
 * Loads and parses a JSON document from the local filesystem.
 *
 * This implementation is intended for Node.js environments and dynamically
 * imports `fs/promises` so that filesystem-specific functionality is not
 * eagerly loaded by consumers running in environments where it is unavailable.
 *
 * The resource is first checked for accessibility before being read and
 * parsed as UTF-8 encoded JSON.
 *
 * Any filesystem or JSON parsing failure is caught and reported to the
 * console. The loader returns `undefined` when the resource cannot be
 * accessed, read, or parsed.
 *
 * @param path - The filesystem path identifying the JSON resource.
 * @param jectOptions - any options to pass to the file loader.
 *
 * @returns A promise that resolves to the parsed JSON object, or `undefined`
 * if the resource could not be accessed, read, or parsed.
 */
const FileLoader: JsonLoader = async (
    path: string,
    jectOptions: JectOptions
): Promise<object | undefined> => {

    if (jectOptions.customFileLoader) {
        return jectOptions.customFileLoader(path)
    }

    const fs = await import("fs/promises");

    try {
        await fs.access(path);

        return JSON.parse(
            await fs.readFile(path, {
                encoding: "utf-8"
            })
        );
    }
    catch (e) {
        console.error("JECT", { e, path });
        return undefined;
    }
};

/**
 * Loads and parses a JSON resource using the appropriate loader for the
 * current execution environment.
 *
 * Node.js environments use the local filesystem loader, while environments
 * without Node.js's runtime identifier use the Fetch API loader.
 *
 * @param path - The path or URL identifying the JSON resource.
 * @param jectOptions - Any additional options for loading JSON
 *
 * @returns A promise that resolves to the parsed JSON object, or `undefined`
 * if the resource could not be loaded.
 */
export const LoadJson: JsonLoader = async (
    path: string,
    jectOptions: JectOptions
): Promise<object | undefined> => {
    const isNode =
        typeof process !== "undefined" &&
        typeof process.versions?.node === "string";

    return isNode
        ? FileLoader(path, jectOptions)
        : WebLoader(path, jectOptions);
};

/**
 * Represents the input accepted by the `@require` directive.
 *
 * A single path loads one JSON object directly. Multiple paths load all
 * referenced JSON objects and merge them into a single object.
 */
export type RequireInput = string | string[];

/**
 * Ject directive responsible for resolving external JSON resources.
 *
 * The `@require` directive supports both single-resource and multi-resource
 * loading.
 *
 * When supplied with a single path, the referenced JSON document replaces
 * the directive node directly.
 *
 * When supplied with multiple paths, each JSON document is loaded and the
 * resulting objects are merged into a single object. Resources are merged
 * from left to right, meaning properties from later resources override
 * properties with the same name from earlier resources.
 *
 * @example
 * Loading a single resource:
 *
 * ```json
 * {
 *     "user": {
 *         "@require": "./user.json"
 *     }
 * }
 * ```
 *
 * @example
 * Loading and merging multiple resources:
 *
 * ```json
 * {
 *     "config": {
 *         "@require": [
 *             "./base.json",
 *             "./production.json"
 *         ]
 *     }
 * }
 * ```
 *
 * If `base.json` contains:
 *
 * ```json
 * {
 *     "host": "localhost",
 *     "port": 3000
 * }
 * ```
 *
 * and `production.json` contains:
 *
 * ```json
 * {
 *     "host": "production.example.com"
 * }
 * ```
 *
 * the resulting value is:
 *
 * ```json
 * {
 *     "host": "production.example.com",
 *     "port": 3000
 * }
 * ```
 *
 * @remarks
 * Multiple resources are loaded concurrently. Merge order is deterministic
 * and follows the order in which paths are supplied.
 *
 * The underlying resource loader is selected automatically according to the
 * current execution environment. Node.js environments load resources from
 * the filesystem, while browser environments use the Fetch API.
 */
export const requireDirective: Directive<
    RequireInput,
    object | undefined
> = {
    /**
     * The node name that activates the directive.
     */
    targetNodeName: "@require",

    /**
     * Resolves one or more resource paths into a JSON object.
     *
     * When `input` is a string, the referenced resource is loaded directly.
     *
     * When `input` is an array, all resources are loaded concurrently and
     * their resulting objects are merged from left to right. Later resources
     * override properties defined by earlier resources.
     *
     * @param input - A resource path or an ordered collection of resource
     * paths to load.
     *
     * @returns A promise resolving to the loaded JSON object, or `undefined`
     * if the resource or resources could not be loaded.
     */
    transform: async (
        input: RequireInput,
        jectOptions: JectOptions
    ): Promise<object | undefined> => {
        if (typeof input === "string") {
            return LoadJson(input, jectOptions);
        }

        const results = await Promise.all(
            input.map((path) => LoadJson(path, jectOptions))
        );

        if (results.some((result) => result === undefined)) {
            return undefined;
        }

        return Object.assign({}, ...results);
    }
};