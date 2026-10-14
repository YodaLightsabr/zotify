export class Block {
    #store;
    constructor(input, index) {
        for (const [key, value] of Object.entries(input)) {
            this[key] = value;
        }
        this.#store = { index };
    }
    getIndex() {
        return this.#store.index;
    }
}
export function filterLeafBlocks(lindyn, qualifies) {
    const matches = [];
    let index = 0;
    const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
    // In this data shape, blocks have both an id and a type.
    // Requiring id avoids treating objects like `action: { type: "push" }` as blocks.
    const isBlock = (value) => "id" in value && "type" in value;
    function visit(node) {
        if (Array.isArray(node)) {
            return node.map(visit).some(Boolean);
        }
        if (!isObject(node)) {
            return false;
        }
        const hasDescendantBlock = Object.values(node).map(visit).some(Boolean);
        const block = isBlock(node);
        if (block && !hasDescendantBlock) {
            index++;
            const potentilMatch = new Block(node, index);
            if (qualifies(potentilMatch)) {
                matches.push(potentilMatch);
            }
        }
        // Tell ancestors whether this subtree contains any block.
        return block || hasDescendantBlock;
    }
    visit(lindyn);
    return matches;
}
export function findLeafBlock(lindyn, qualifies) {
    return filterLeafBlocks(lindyn, qualifies)[0];
}
//# sourceMappingURL=block.js.map