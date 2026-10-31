import { Parser } from 'acorn';
import jsx from 'acorn-jsx';
import { SourceError, type Literal, type SourceNode } from './contracts.js';

const JSXParser = Parser.extend(jsx());
const tags = new Set(('Deck Brief Theme Token Scale Frame Motif Library Layout Component Slide Transcript Prompt SpeakerNotes Archive ArchivedSlide Stack Row Grid Split Center Spacer Panel Band Text Stat Bullets Quote Image Icon Rule Badge Shape Pending Slot Each Item Index').split(' '));
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
// Acorn's JSX plugin extends ESTree without exporting an AST type. This local boundary
// is intentionally dynamic; every accepted construct is explicitly inspected below.
type Ast = any;

function fail(node: Ast, detail = ''): never {
  throw new SourceError('syntax', `Rejected ${node.type}${detail ? `: ${detail}` : ''}`);
}
function literal(node: Ast, depth = 0): Literal {
  if (depth > 16) fail(node, 'literal nesting exceeds 16');
  if (node.type === 'Literal' && ['string', 'boolean', 'number'].includes(typeof node.value)) {
    if (typeof node.value === 'number' && !Number.isFinite(node.value)) fail(node, 'nonfinite number');
    return node.value;
  }
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number' && Number.isFinite(node.argument.value)) return -node.argument.value;
  if (node.type === 'ArrayExpression') return node.elements.map((item: Ast) => {
    if (!item) fail(node, 'array holes');
    return literal(item, depth + 1);
  });
  if (node.type === 'ObjectExpression') {
    const result: Record<string, Literal> = Object.create(null);
    for (const prop of node.properties) {
      if (prop.type !== 'Property' || prop.computed || prop.method || prop.shorthand || prop.kind !== 'init') fail(prop);
      const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
      if (typeof key !== 'string' || forbiddenKeys.has(key) || Object.hasOwn(result, key)) fail(prop, 'invalid or duplicate object key');
      result[key] = literal(prop.value, depth + 1);
    }
    return result;
  }
  return fail(node);
}
function validateEntities(raw: string) {
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '&') continue;
    const match = /^&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/.exec(raw.slice(i));
    if (!match) throw new SourceError('entity', 'Unknown or malformed entity; escape literal ampersands as &amp;');
    if (match[0].startsWith('&#')) {
      const hex = match[0].startsWith('&#x');
      const value = parseInt(match[0].slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      if (value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) throw new SourceError('entity', 'Invalid Unicode entity');
    }
    i += match[0].length - 1;
  }
}
export function parseSource(source: string): SourceNode {
  if (source.length > 2_000_000) throw new SourceError('source_limit', 'Source exceeds 2 MB');
  let ast: Ast;
  try {
    ast = JSXParser.parse(source, { ecmaVersion: 'latest', sourceType: 'module', onComment: () => { throw new SourceError('syntax', 'Comments are not supported'); } });
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError('syntax', String(error));
  }
  if (ast.body.length !== 1 || ast.body[0].type !== 'ExpressionStatement') fail(ast, 'expected one JSX root');
  const ids = new Set<string>();
  function walk(node: Ast, depth: number): SourceNode {
    if (depth > 64) fail(node, 'parser nesting exceeds 64');
    if (node.type !== 'JSXElement') fail(node);
    const opening = node.openingElement;
    try {
    if (opening.name.type !== 'JSXIdentifier') fail(opening.name);
    const props: Record<string, Literal> = Object.create(null);
    for (const attr of opening.attributes) {
      if (attr.type !== 'JSXAttribute' || attr.name.type !== 'JSXIdentifier' || !attr.value) fail(attr);
      const name = attr.name.name;
      if (forbiddenKeys.has(name) || Object.hasOwn(props, name)) fail(attr, 'duplicate or invalid attribute');
      if (attr.value.type === 'Literal') validateEntities(source.slice(attr.value.start + 1, attr.value.end - 1));
      props[name] = literal(attr.value.type === 'JSXExpressionContainer' ? attr.value.expression : attr.value);
    }
    if (props.id !== undefined && (typeof props.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(props.id))) fail(opening, 'invalid authored id');
    const id = props.id as string | undefined;
    if (id && ids.has(id)) throw new SourceError('duplicate_id', `Duplicate ID ${id}`, id);
    if (id) ids.add(id);
    return {
      tag: opening.name.name, id, props, start: node.start, end: node.end,
      children: node.children.map((child: Ast) => {
        if (child.type === 'JSXText') { validateEntities(source.slice(child.start, child.end)); return child.value; }
        return walk(child, depth + 1);
      }),
    };
    } catch (error) {
      if (error instanceof SourceError) {
        const identity = opening.attributes.find((a: Ast) => a.type === 'JSXAttribute' && a.name.name === 'id' && a.value?.type === 'Literal');
        if (!error.nodeId && typeof identity?.value.value === 'string') error.nodeId = identity.value.value;
        error.span ??= { start: node.start, end: node.end };
      }
      throw error;
    }
  }
  const root = walk(ast.body[0].expression, 1);
  if (root.tag !== 'Deck') throw new SourceError('root', 'Expected Deck root');
  const definitions = new Set<string>();
  for (const node of nodes(root)) {
    if (node.tag !== 'Layout' && node.tag !== 'Component') continue;
    if (typeof node.props.name !== 'string' || !/^[A-Z][A-Za-z0-9]*$/.test(node.props.name) || tags.has(node.props.name) || definitions.has(node.props.name)) throw new SourceError('definition_name', 'Invalid or duplicate definition name', node.id);
    definitions.add(node.props.name);
  }
  for (const node of nodes(root)) if (!tags.has(node.tag) && !definitions.has(node.tag)) throw new SourceError('unknown_tag', `Unknown tag ${node.tag}`, node.id);
  return root;
}
export function* nodes(root: SourceNode): Generator<SourceNode> {
  yield root;
  for (const child of root.children) if (typeof child !== 'string') yield* nodes(child);
}
export function nodeById(root: SourceNode, id: string): SourceNode {
  for (const node of nodes(root)) if (node.id === id) return node;
  throw new SourceError('missing_node', `Node ${id} does not exist`, id);
}
export function textContent(node: SourceNode): string {
  return node.children.map(child => typeof child === 'string' ? child : textContent(child)).join('');
}
