export class Block {
    [key: string]: any;
    #store: {
        index: number;
    }

    constructor(input: Record<string, any>, index: number) {
        for (const [key, value] of Object.entries(input)) {
            this[key] = value;
        }

        this.#store = { index };
    }

    getIndex () {
        return this.#store.index;
    }
}

export function filterLeafBlocks(
    lindyn: unknown,
    qualifies: (block: Block) => boolean
): Block[] {
    const matches: Block[] = [];
    let index = 0;

    const isObject = (value: unknown): value is Block =>
        value !== null && typeof value === "object" && !Array.isArray(value);

    // In this data shape, blocks have both an id and a type.
    // Requiring id avoids treating objects like `action: { type: "push" }` as blocks.
    const isBlock = (value: Block): boolean =>
        "id" in value && "type" in value;

    function visit(node: unknown): boolean {
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

export function findLeafBlock(
    lindyn: unknown,
    qualifies: (block: Block) => boolean
): Block | undefined {
    return filterLeafBlocks(lindyn, qualifies)[0];
}
