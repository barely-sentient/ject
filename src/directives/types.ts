/**
 * Defines a transformation that can be applied to a JSON node during
 * document resolution.
 *
 * A directive is identified by a target node name and is responsible for
 * transforming the value associated with that node into a resolved value.
 *
 * Directives are the primary extension mechanism used by Ject. Built-in
 * directives can be implemented alongside user-defined directives, allowing
 * the resolution pipeline to be extended without modifying the core resolver.
 *
 * @example
 * A directive may be represented in a Ject document as:
 *
 * ```json
 * {
 *   "userId": {
 *     "@var": "$userId"
 *   }
 * }
 * ```
 *
 * The `@var` directive would receive `"$userId"` as its input and return
 * the corresponding resolved value.
 *
 * @typeParam TInput - The type of value expected by the directive.
 * @typeParam TOutput - The type of value produced by the directive.
 */
export type Directive<TInput = unknown, TOutput = unknown> = {
    /**
     * Gets the name of the JSON node that activates this directive.
     *
     * The returned value is matched against node names encountered during
     * document resolution. Directive names should be unique within a
     * resolver instance.
     *
     * @returns The target node name used to identify the directive.
     *
     * @example
     * ```ts
     * targetNodeName: "@var"
     * ```
     */
    targetNodeName: string,

    /**
     * Transforms the value associated with the directive into its resolved
     * representation.
     *
     * The returned value replaces the directive node in the resolved
     * document. The transformation may be asynchronous, allowing directives
     * to perform I/O such as loading files, resolving external resources,
     * or retrieving contextual data.
     *
     * Implementations should avoid mutating the supplied value. A directive
     * should instead return the value that should occupy the node after
     * resolution.
     *
     * @param value - The value associated with the directive in the source
     * document.
     * @param resolve - Optional resolver that recursively resolves a Ject
     * node through the active directive pipeline. Directives may use this
     * to evaluate nested directives within their input.
     *
     * @returns A promise containing the resolved value that will replace the
     * directive node.
     *
     * @example
     * ```ts
     * transform: async (value) => {
     *     return variables[value as string];
     * }
     * ```
     */
    transform: (value: TInput, resolve?: (node: unknown) => Promise<unknown>) => Promise<TOutput>,

    /**
     * Controls whether property values within the directive's input are
     * recursively resolved before the transform is invoked.
     *
     * When set to `true`, every property value of the input object is
     * resolved through the resolver. This allows directives like `@default`
     * to compose with other directives in their input.
     *
     * When set to an array of strings, only the listed property keys are
     * resolved. All other property values are passed through unchanged.
     *
     * When `undefined`, the input is passed to the transform without
     * pre-resolution.
     *
     * @example
     * ```ts
     * resolveInput: true    // resolve all property values
     * resolveInput: ["value"]  // resolve only the "value" key
     * ```
     */
    resolveInput?: true | string[],

    /**
     * Optional callback invoked on the value produced by the transform.
     *
     * When set, the resolver passes the transform's result through this
     * callback before completing. This allows directives like `@require`
     * to have their loaded content recursively resolved without creating
     * circular dependencies.
     *
     * @param value - The transform's output value.
     *
     * @returns A promise resolving to the final value after post-processing.
     */
    transformOutput?: (value: TOutput) => Promise<TOutput>
};