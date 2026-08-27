// src/directives/require.ts
var WebLoader = async (url) => {
  try {
    const response = await fetch(url);
    const result = await response.json();
    return result;
  } catch (e) {
    console.error("JECT", { e, url });
  }
  return void 0;
};
var FileLoader = async (path) => {
  const fs = await import("fs/promises");
  try {
    await fs.access(path);
    return JSON.parse(
      await fs.readFile(path, {
        encoding: "utf-8"
      })
    );
  } catch (e) {
    console.error("JECT", { e, path });
    return void 0;
  }
};
var LoadJson = async (path) => {
  const isNode = typeof process !== "undefined" && typeof process.versions?.node === "string";
  return isNode ? FileLoader(path) : WebLoader(path);
};
var requireDirective = {
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
  transform: async (input) => {
    if (typeof input === "string") {
      return LoadJson(input);
    }
    const results = await Promise.all(
      input.map((p) => LoadJson(p))
    );
    if (results.some((result) => result === void 0)) {
      return void 0;
    }
    return Object.assign({}, ...results);
  }
};

// src/directives/variable.ts
var createVariablesDirective = (variables) => ({
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
  transform: async (variableName) => {
    if (!Object.prototype.hasOwnProperty.call(variables, variableName)) {
      console.warn(`JECT: Unknown variable "${variableName}"`);
      return void 0;
    }
    return variables[variableName];
  }
});

// src/directives/default.ts
var defaultDirective = {
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
  transform: async (input, resolve) => {
    let value;
    if ("value" in input) {
      value = input.value;
    } else if (resolve) {
      const keys = Object.keys(input).filter((k) => k !== "default");
      if (keys.length > 0) {
        value = await resolve({ [keys[0]]: input[keys[0]] });
      }
    }
    return value !== void 0 ? value : input.default;
  },
  /**
   * Resolve the `value` property before the transform is invoked so that
   * nested directives such as `@env` are evaluated first.
   */
  resolveInput: true
};

// src/directives/env.ts
var envDirective = {
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
  transform: async (envName) => {
    return process.env[envName];
  }
};

// src/parse.ts
var createDirectives = (options) => {
  const directives = [
    {
      ...requireDirective,
      transformOutput: async (value) => {
        return handleNode(value, directives);
      }
    },
    ...options.directives ?? [],
    envDirective,
    defaultDirective,
    // always last, as this injects variables.
    createVariablesDirective(options.variables ?? {})
  ];
  return directives;
};
var parseFromString = async (source, options = {}) => {
  const result = JSON.parse(source);
  if (result === null || result === void 0) {
    return result;
  }
  const directives = createDirectives(options);
  return await handleNode(result, directives);
};
var parseFromUri = async (path, options = {}) => {
  const resolved = await LoadJson(path);
  if (resolved === void 0) {
    return void 0;
  }
  const directives = createDirectives(options);
  const result = await handleNode(resolved, directives);
  return result;
};
var handleNode = async (node, directives) => {
  if (node === null || typeof node !== "object") {
    return node;
  }
  if (Array.isArray(node)) {
    return Promise.all(
      node.map((entry) => handleNode(entry, directives))
    );
  }
  const object = node;
  const directive = directives.find(
    (entry) => Object.prototype.hasOwnProperty.call(
      object,
      entry.targetNodeName
    )
  );
  if (directive) {
    let input = object[directive.targetNodeName];
    if (directive.resolveInput && typeof input === "object" && input !== null) {
      const resolved = { ...input };
      const keys = directive.resolveInput === true ? Object.keys(resolved) : directive.resolveInput;
      for (const key of keys) {
        if (key in resolved) {
          resolved[key] = await handleNode(resolved[key], directives);
        }
      }
      input = resolved;
    }
    const result = await directive.transform(input, (node2) => handleNode(node2, directives));
    const output = directive.transformOutput ? await directive.transformOutput(result) : result;
    return handleNode(output, directives);
  }
  const entries = await Promise.all(
    Object.entries(object).map(async ([key, value]) => {
      return [
        key,
        await handleNode(value, directives)
      ];
    })
  );
  return Object.fromEntries(entries);
};
export {
  parseFromString,
  parseFromUri
};
