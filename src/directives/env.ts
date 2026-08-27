import { Directive } from "./types.js";

/**
 * Ject directive that resolves a named environment variable from the
 * current Node.js process.
 *
 * The directive reads the value associated with the supplied environment
 * variable name from `process.env`.
 *
 * @example
 * Using a standalone environment variable:
 *
 * ```json
 * {
 *     "port": {
 *         "@env": "PORT"
 *     }
 * }
 * ```
 *
 * If the process environment contains `PORT=8080`, the result is:
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
 *     "port": undefined
 * }
 * ```
 *
 * @remarks
 * Environment variables are exposed by Node.js as strings. This directive
 * does not perform any type conversion, validation, or default-value
 * handling.
 *
 * This directive is intended for Node.js environments and requires access
 * to the Node.js `process.env` API.
 */
export const envDirective: Directive<string, string | undefined> = {
    /**
     * The node name that activates the environment directive.
     */
    targetNodeName: "@env",

    /**
     * Resolves the supplied environment variable name against
     * `process.env`.
     *
     * @param envName - The name of the environment variable to resolve.
     *
     * @returns A promise resolving to the environment variable's value,
     * or `undefined` when the specified variable is not defined.
     */
    transform: async (
        envName: string
    ): Promise<string | undefined> => {
        return process.env[envName];
    }
};
