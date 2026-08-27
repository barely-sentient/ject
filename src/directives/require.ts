import { Directive } from "./types.js";

/**
 * Represents an asynchronous function capable of loading and parsing a JSON
 * document from a resource identified by a path or URL.
 *
 * @param path - The path, URL, or other resource identifier used to locate
 * the JSON document.
 *
 * @returns A promise that resolves to the parsed JSON object when the
 * resource can be successfully loaded and parsed; otherwise `undefined`.
 */
export type JsonLoader = (
    path: string
) => Promise<object | undefined>;

/**
 * Loads and parses a JSON document using the Fetch API.
 *
 * @param url - The URL identifying the JSON resource to retrieve.
 *
 * @returns A promise that resolves to the parsed JSON object, or `undefined`
 * if the resource could not be retrieved or parsed.
 */
const WebLoader: JsonLoader = async (
    url: string
): Promise<object | undefined> => {
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
 * @param path - The filesystem path identifying the JSON resource.
 *
 * @returns A promise that resolves to the parsed JSON object, or `undefined`
 * if the resource could not be accessed, read, or parsed.
 */
const FileLoader: JsonLoader = async (
    path: string
): Promise<object | undefined> => {
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
 * @param path - The path or URL identifying the JSON resource.
 *
 * @returns A promise that resolves to the parsed JSON object, or `undefined`
 * if the resource could not be loaded.
 */
export const LoadJson: JsonLoader = async (
    path: string
): Promise<object | undefined> => {
    const isNode =
        typeof process !== "undefined" &&
        typeof process.versions?.node === "string";

    return isNode
        ? FileLoader(path)
        : WebLoader(path);
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
 * Loaded documents are recursively resolved, so any directives within them
 * are processed.
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
 * @remarks
 * Multiple resources are loaded concurrently. Merge order is deterministic
 * and follows the order in which paths are supplied.
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
        input: RequireInput
    ): Promise<object | undefined> => {
        if (typeof input === "string") {
            return LoadJson(input);
        }

        const results = await Promise.all(
            input.map((p) => LoadJson(p))
        );

        if (results.some((result) => result === undefined)) {
            return undefined;
        }

        return Object.assign({}, ...results);
    }
};
