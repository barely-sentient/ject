import { Directive } from "./types.js";

/**
 * Defines the input accepted by the `@default` directive.
 *
 * The directive evaluates the supplied value and returns it when it is
 * defined. When the value resolves to `undefined`, the configured default
 * value is returned instead.
 */
export type DefaultInput = {
    /**
     * The value to evaluate.
     *
     * This may itself contain another Ject directive.
     */
    value: unknown;

    /**
     * The value to return when `value` resolves to `undefined`.
     */
    default: unknown;
};

/**
 * Ject directive that provides a fallback value when another value is
 * undefined.
 *
 * `@default` is primarily intended to be composed with other directives such
 * as `@var`, `@env`, and `@require`.
 *
 * @example
 * Using an environment variable with a fallback:
 *
 * ```json
 * {
 *     "port": {
 *         "@default": {
 *             "value": {
 *                 "@env": "PORT"
 *             },
 *             "default": 3000
 *         }
 *     }
 * }
 * ```
 *
 * If `PORT` is defined as `"8080"`, the result is:
 *
 * ```json
 * {
 *     "port": "8080"
 * }
 * ```
 *
 * If `PORT` is not defined, the result is:
 *
 * ```json
 * {
 *     "port": 3000
 * }
 * ```
 *
 * @remarks
 * The default value is only used when the resolved value is `undefined`.
 * Values such as `null`, `false`, `0`, and an empty string are considered
 * valid values and are returned unchanged.
 */
export const defaultDirective: Directive<
    DefaultInput,
    unknown
> = {
    /**
     * The node name that activates the default directive.
     */
    targetNodeName: "@default",

    /**
     * Resolves a value and falls back to the configured default when the
     * value is undefined.
     *
     * @param input - The value and fallback configuration.
     *
     * @returns The supplied value when defined; otherwise the default value.
     */
    transform: async (
        input: Record<string, unknown>,
        resolve?: (node: unknown) => Promise<unknown>
    ): Promise<unknown> => {
        let value: unknown;

        if ("value" in input) {
            value = input.value;
        } else if (resolve) {
            const keys = Object.keys(input).filter((k) => k !== "default");

            if (keys.length > 0) {
                value = await resolve({ [keys[0]]: input[keys[0]] });
            }
        }

        return value !== undefined
            ? value
            : input.default;
    },

    /**
     * Resolve the `value` property before the transform is invoked so that
     * nested directives such as `@env` are evaluated first.
     */
    resolveInput: true
};
