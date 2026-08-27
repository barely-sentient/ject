

import { parseFromUri } from "../dist/index.js";

const result = await parseFromUri("./playground/schemas/context.json", {
    variables: {
        "$username": "[DEFAULT USERNAME HERE]",
        "$defaultRoleName": "[DEFAULT ROLE NAME]"
    }
});

console.log(JSON.stringify(result,null,4));