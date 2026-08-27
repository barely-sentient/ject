import { LoadJson, requireDirective } from "./directives/require.js";
import { Directive } from "./directives/types.js";
import { createVariablesDirective } from "./directives/variable.js";
import { defaultDirective } from "./directives/default.js"
import { envDirective } from "./directives/env.js"

/**
 * Options used to configure a Ject parsing operation.
 *
 * @typeParam TVariables - The type of values available to the variable
 * directive.
 */
export type JectOptions<TVariables extends Record<string, unknown> = Record<string, unknown>> = {
    /**
     * Values available to the `@var` directive during document resolution.
     *
     * @default {}
     */
    variables?: TVariables;

    /**
     * Additional directives to register for the parsing operation.
     *
     * Custom directives are added alongside Ject's built-in directives.
     *
     * @default []
     */
    directives?: Directive<unknown>[];

    /**
     * Specify a custom file loader that allows mock FS's to be used
     * @param path - the path
     * @returns Promise<object | undefined>
     */
    customFileLoader?: (path: string) => Promise<object | undefined>;

    /**
     * Specify a custom file loader that allows mock URL resolvers to be used
     * @param path - the path
     * @returns Promise<object | undefined>
     */
    customUrlLoader?: (url: string) => Promise<object | undefined>;
};

/**
 * Creates the directive collection used by a Ject parsing operation.
 *
 * Ject's built-in directives are registered automatically. Additional
 * application-specific directives can be supplied through the options.
 *
 * @param options - Configuration for the parsing operation.
 *
 * @returns The directives available to the resolver.
 */
const createDirectives = (
    options: JectOptions
): Directive<unknown>[] => {
    const directives: Directive<unknown>[] = [
        {
            ...(requireDirective as Directive<unknown>),
            transformOutput: async (value) => {
                return handleNode(value, directives, options);
            }
        },
        ...(options.directives ?? []),

        envDirective as Directive<unknown>,
        defaultDirective as Directive<unknown>,
        // always last, as this injects variables.
        createVariablesDirective(options.variables ?? {}) as Directive<unknown>
    ];

    return directives;
};

/**
 * Parses and resolves a JSON document from a string.
 *
 * The supplied JSON is parsed and recursively traversed. Registered Ject
 * directives encountered during traversal are resolved and replaced with
 * their resulting values.
 *
 * Ject's built-in directives are registered automatically. Custom directives
 * may be supplied through the `options` parameter.
 *
 * @typeParam TOutput - The expected type of the resolved document.
 *
 * @param source - A string containing a valid JSON document.
 * @param options - Configuration for the parsing operation.
 *
 * @returns A promise resolving to the transformed document, or `undefined`
 * if the parsed source is `null`.
 *
 * @throws {SyntaxError} If `source` does not contain valid JSON.
 *
 * @example
 * ```ts
 * const result = await parseFromString(
 *     `{
 *         "user": {
 *             "@var": "userId"
 *         }
 *     }`,
 *     {
 *         variables: {
 *             userId: 12
 *         }
 *     }
 * );
 * ```
 *
 * @example
 * Registering a custom directive:
 *
 * ```ts
 * const result = await parseFromString(
 *     source,
 *     {
 *         variables: {
 *             userId: 12
 *         },
 *         directives: [
 *             myCustomDirective
 *         ]
 *     }
 * );
 * ```
 */
export const parseFromString = async <TOutput = unknown>(
    source: string,
    options: JectOptions = {}
): Promise<TOutput | undefined> => {
    const result: unknown = JSON.parse(source);

    if (result === null || result === undefined) {
        return result as TOutput | undefined;
    }

    const directives = createDirectives(options);

    return await handleNode(result, directives, options) as TOutput;
};

/**
 * Loads, parses, and resolves a JSON document from a URI or filesystem path.
 *
 * The underlying JSON loader automatically selects an appropriate loading
 * mechanism for the current execution environment.
 *
 * @typeParam TOutput - The expected type of the resolved document.
 *
 * @param path - The URI or filesystem path of the JSON document.
 * @param options - Configuration for the parsing operation.
 *
 * @returns A promise resolving to the transformed document, or `undefined`
 * if the document could not be loaded.
 *
 * @example
 * ```ts
 * const result = await parseFromUri(
 *     "./schemas/user.json",
 *     {
 *         variables: {
 *             userId: 12
 *         }
 *     }
 * );
 * ```
 */
export const parseFromUri = async <TOutput = unknown>(
    path: string,
    options: JectOptions = {}
): Promise<TOutput | undefined> => {
    const resolved = await LoadJson(path, options);

    if (resolved === undefined) {
        return undefined;
    }

    const directives = createDirectives(options);
    const result = await handleNode(resolved, directives, options);

    return result as TOutput;
};

/**
 * Recursively resolves a JSON node using the supplied directives.
 *
 * Primitive values are returned unchanged. Arrays and objects are traversed
 * recursively, while objects containing a registered directive are delegated
 * to that directive for transformation.
 *
 * @param node - The JSON node to resolve.
 * @param directives - Directives available during resolution.
 *
 * @returns A promise resolving to the transformed JSON node.
 */
const handleNode = async (
    node: unknown,
    directives: Directive<unknown>[],
    jectOptions: JectOptions
): Promise<unknown> => {
    /*
     * Primitive JSON values do not contain child nodes and therefore require
     * no further processing.
     */
    if (
        node === null ||
        typeof node !== "object"
    ) {
        return node;
    }

    /*
     * Resolve each array element independently.
     */
    if (Array.isArray(node)) {
        return Promise.all(
            node.map((entry) => handleNode(entry, directives, jectOptions))
        );
    }

    const object = node as Record<string, unknown>;

    /*
     * Find the directive responsible for this node.
     */
    const directive = directives.find(
        (entry) => Object.prototype.hasOwnProperty.call(
            object,
            entry.targetNodeName
        )
    );

    if (directive) {
        let input = object[directive.targetNodeName];

        if (directive.resolveInput && typeof input === "object" && input !== null) {
            const resolved: Record<string, unknown> = { ...(input as Record<string, unknown>) };

            const keys = directive.resolveInput === true
                ? Object.keys(resolved)
                : directive.resolveInput;

            for (const key of keys) {
                if (key in resolved) {
                    resolved[key] = await handleNode(resolved[key], directives, jectOptions);
                }
            }

            input = resolved;
        }

        const result = await directive.transform(input, jectOptions , (node) => handleNode(node, directives, jectOptions));

        /*
         * A directive may produce another Ject document. Resolve the result
         * recursively so directives can be composed.
         */
        const output = directive.transformOutput
            ? await directive.transformOutput(result as never)
            : result;

        return handleNode(output, directives, jectOptions);
    }

    /*
     * Resolve each property of an ordinary JSON object independently.
     */
    const entries = await Promise.all(
        Object.entries(object).map(async ([key, value]) => {
            return [
                key,
                await handleNode(value, directives, jectOptions)
            ] as const;
        })
    );

    return Object.fromEntries(entries);
};