import { Directive } from "./types.js";

/**
 * Creates a Ject directive for resolving named variables.
 *
 * The resulting directive resolves `@var` nodes against the variable
 * collection supplied when the directive is created.
 *
 * @param variables - Values available to the directive during resolution.
 *
 * @returns A configured variable directive.
 *
 * @example
 * ```ts
 * const variablesDirective = createVariablesDirective({
 *     userId: 12,
 *     username: "John"
 * });
 *
 * registerDirective(variablesDirective);
 * ```
 *
 * A document containing:
 *
 * ```json
 * {
 *     "id": {
 *         "@var": "userId"
 *     },
 *     "name": {
 *         "@var": "username"
 *     }
 * }
 * ```
 *
 * resolves to:
 *
 * ```json
 * {
 *     "id": 12,
 *     "name": "John"
 * }
 * ```
 */
export const createVariablesDirective = (
    variables: Record<string, unknown>
): Directive<string> => ({
    /**
     * The node name that activates the variable directive.
     */
    targetNodeName: "@var",

    /**
     * Resolves the supplied variable name against the configured variables.
     *
     * @param variableName - The name of the variable to resolve.
     *
     * @returns The value associated with the variable, or `undefined` when
     * the variable has not been defined.
     */
    transform: async (
        variableName: string
    ): Promise<unknown> => {
        if (!Object.prototype.hasOwnProperty.call(variables, variableName)) {
            console.warn(`JECT: Unknown variable "${variableName}"`);
            return undefined;
        }

        return variables[variableName];
    }
});