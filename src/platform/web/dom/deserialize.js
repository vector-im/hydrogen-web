import { MessageBody, HeaderBlock, ListBlock, CodeBlock, FormatPart, NewLinePart, RulePart, TextPart, LinkPart } from "../../../domain/session/room/timeline/MessageBody.js"


/* At the time of writing (Jul 1 2021), Matrix Spec recommends
 * allowing the following HTML tags:
 *     font, del, h1, h2, h3, h4, h5, h6, blockquote, p, a, ul, ol, sup, sub, li, b, i, u,
 *     strong, em, strike, code, hr, br, div, table, thead, tbody, tr, th, td, caption, pre, span, img
 */

/**
 * Nodes that don't have any properties to them other than their tag.
 * While <a> has `href`, and <img> has `src`, these have... themselves.
 */
const basicNodes = ["EM", "STRONG", "CODE", "DEL", "P", "DIV", "SPAN" ]

/**
 * Return a builder function for a particular tag.
 */
function basicWrapper(tag) {
    return (result, node, children) => new FormatPart(tag, children);
}

/**
 * Return a builder function for a particular header level.
 */
function headerWrapper(level) {
    return (result, node, children) => new HeaderBlock(level, children);
}

function parseLink(result, node, children) {
    // TODO Not equivalent to `node.href`!
    // Add another HTMLParseResult method?
    let href = result.getAttributeValue(node, "href");
    return new LinkPart(href, children);
}

function parseList(result, node) {
    // TODO Attribute's a string.
    const start = result.getAttributeValue(node, "start") || 1;
    const nodes = [];
    for (const child of result.getChildNodes(node)) {
        if (result.getNodeElementName(child) !== "LI") {
            continue;
        }
        const item = parseNodes(result, result.getChildNodes(child));
        nodes.push(item);
    }
    return new ListBlock(start, nodes);
}

function parseCodeBlock(result, node) {
    let codeNode;
    for (const child of result.getChildNodes(node)) {
        codeNode = child;
        break;
    }
    if (!(codeNode && result.getNodeElementName(codeNode) === "CODE")) {
        return null;
    }
    let language = "";
    const cl = result.getAttributeValue(codeNode, "class") || ""
    for (const clname of cl.split(" ")) {
        if (clname.startsWith("language-") && !clname.startsWith("language-_")) {
            language = clname.substring(9) // "language-".length
            break;
        }
    }
    return new CodeBlock(language, codeNode.textContent);
}

function parseImage(result, node) {
    return null;
}

function buildNodeMap() {
    let map = {
        A: { descend: true, parsefn: parseLink },
        UL: { descend: false, parsefn: parseList },
        OL: { descend: false, parsefn: parseList },
        PRE: { descend: false, parsefn: parseCodeBlock },
        BR: { descend: false, parsefn: () => new NewLinePart() },
        HR: { descend: false, parsefn: () => new RulePart() },
        IMG: { descend: false, parsefn: parseImage }
    }
    for (const tag of basicNodes) {
        map[tag] = { descend: true, parsefn: basicWrapper(tag) }
    }
    for (let level = 1; level <= 6; level++) {
        const tag = "h" + level;
        map[tag] = { descend: true, parsefn: headerWrapper(level) }
    }
    return map;
}

/**
 * Handlers for various nodes.
 *
 * Each handler has two properties: `descend` and `parsefn`.
 * If `descend` is true, the node's children should be
 * parsed just like any other node, and fed as a second argument
 * to `parsefn`. If not, the node's children are either to be ignored
 * (as in <pre>) or processed specially (as in <ul>).
 *
 * The `parsefn` combines a node's data and its children into
 * an internal representation node.
 */
const nodes = buildNodeMap();

function parseNode(result, node) {
    if (result.isTextNode(node)) {
        return new TextPart(result.getNodeText(node));
    } else if (result.isElementNode(node)) {
        const f = nodes[result.getNodeElementName(node)];
        if (!f) {
            return null;
        }
        const children = f.descend ? parseNodes(result, node.childNodes) : null;
        return f.parsefn(result, node, children);
    }
    return null;
}

function parseNodes(result, nodes) {
    const parsed = [];
    for (const htmlNode of nodes) {
        let node = parseNode(result, htmlNode);
        // Just ignore invalid / unknown tags.
        if (node) {
            parsed.push(node);
        }
    }
    return parsed;
}

export function parseHTMLBody(platform, html) {
    const parseResult = platform.parseHTML(html);
    const parts = parseNodes(parseResult, parseResult.rootNodes);
    return new MessageBody(html, parts);
}
