/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {dirname, relative} from 'canonical-path';
import * as ts from 'typescript';
import MagicString from 'magic-string';
import {Import, ImportManager} from '../../../src/ngtsc/translator';
import {ExportInfo} from '../analysis/private_declarations_analyzer';
import {UmdReflectionHost} from '../host/umd_host';
import {Esm5RenderingFormatter} from './esm5_rendering_formatter';
import {stripExtension} from './utils';

type CommonJsConditional = ts.ConditionalExpression & {whenTrue: ts.CallExpression};
type AmdConditional = ts.ConditionalExpression & {whenTrue: ts.CallExpression};

/**
 * A RenderingFormatter that works with UMD files, instead of `import` and `export` statements
 * the module is an IIFE with a factory function call with dependencies, which are defined in a
 * wrapper function for AMD, CommonJS and global module formats.
 */
export class UmdRenderingFormatter extends Esm5RenderingFormatter {
  constructor(protected umdHost: UmdReflectionHost, isCore: boolean) { super(umdHost, isCore); }

  /**
   *  Add the imports to the UMD module IIFE.
   */
  addImports(output: MagicString, imports: Import[], file: ts.SourceFile): void {
    // Assume there is only one UMD module in the file
    const umdModule = this.umdHost.getUmdModule(file);
    if (!umdModule) {
      return;
    }

    const wrapperFunction = umdModule.wrapperFn;

    // We need to add new `require()` calls for each import in the CommonJS initializer
    renderCommonJsDependencies(output, wrapperFunction, imports);
    renderAmdDependencies(output, wrapperFunction, imports);
    renderGlobalDependencies(output, wrapperFunction, imports);
    renderFactoryParameters(output, wrapperFunction, imports);
  }

  /**
   * Add the exports to the bottom of the UMD module factory function.
   */
  addExports(
      output: MagicString, entryPointBasePath: string, exports: ExportInfo[],
      importManager: ImportManager, file: ts.SourceFile): void {
    const umdModule = this.umdHost.getUmdModule(file);
    if (!umdModule) {
      return;
    }
    const factoryFunction = umdModule.factoryFn;
    const lastStatement =
        factoryFunction.body.statements[factoryFunction.body.statements.length - 1];
    const insertionPoint =
        lastStatement ? lastStatement.getEnd() : factoryFunction.body.getEnd() - 1;
    exports.forEach(e => {
      const basePath = stripExtension(e.from);
      const relativePath = './' + relative(dirname(entryPointBasePath), basePath);
      const namedImport = entryPointBasePath !== basePath ?
          importManager.generateNamedImport(relativePath, e.identifier) :
          {symbol: e.identifier, moduleImport: null};
      const importNamespace = namedImport.moduleImport ? `${namedImport.moduleImport}.` : '';
      const exportStr = `\nexports.${e.identifier} = ${importNamespace}${namedImport.symbol};`;
      output.appendRight(insertionPoint, exportStr);
    });
  }

  /**
   * Add the constants to the top of the UMD factory function.
   */
  addConstants(output: MagicString, constants: string, file: ts.SourceFile): void {
    if (constants === '') {
      return;
    }
    const umdModule = this.umdHost.getUmdModule(file);
    if (!umdModule) {
      return;
    }
    const factoryFunction = umdModule.factoryFn;
    const firstStatement = factoryFunction.body.statements[0];
    const insertionPoint =
        firstStatement ? firstStatement.getStart() : factoryFunction.body.getStart() + 1;
    output.appendLeft(insertionPoint, '\n' + constants + '\n');
  }
}

/**
 * Add dependencies to the CommonJS part of the UMD wrapper function.
 */
function renderCommonJsDependencies(
    output: MagicString, wrapperFunction: ts.FunctionExpression, imports: Import[]) {
  const conditional = find(wrapperFunction.body.statements[0], isCommonJSConditional);
  if (!conditional) {
    return;
  }
  const factoryCall = conditional.whenTrue;
  const injectionPoint = factoryCall.getEnd() -
      1;  // Backup one char to account for the closing parenthesis on the call
  imports.forEach(i => output.appendLeft(injectionPoint, `,require('${i.specifier}')`));
}

/**
 * Add dependencies to the AMD part of the UMD wrapper function.
 */
function renderAmdDependencies(
    output: MagicString, wrapperFunction: ts.FunctionExpression, imports: Import[]) {
  const conditional = find(wrapperFunction.body.statements[0], isAmdConditional);
  if (!conditional) {
    return;
  }
  const dependencyArray = conditional.whenTrue.arguments[1];
  if (!dependencyArray || !ts.isArrayLiteralExpression(dependencyArray)) {
    return;
  }
  const injectionPoint = dependencyArray.getEnd() -
      1;  // Backup one char to account for the closing square bracket on the array
  imports.forEach(i => output.appendLeft(injectionPoint, `,'${i.specifier}'`));
}

/**
 * Add dependencies to the global part of the UMD wrapper function.
 */
function renderGlobalDependencies(
    output: MagicString, wrapperFunction: ts.FunctionExpression, imports: Import[]) {
  const globalFactoryCall = find(wrapperFunction.body.statements[0], isGlobalFactoryCall);
  if (!globalFactoryCall) {
    return;
  }
  // Backup one char to account for the closing parenthesis after the argument list of the call.
  const injectionPoint = globalFactoryCall.getEnd() - 1;
  imports.forEach(i => output.appendLeft(injectionPoint, `,global.${getGlobalIdentifier(i)}`));
}

/**
 * Add dependency parameters to the UMD factory function.
 */
function renderFactoryParameters(
    output: MagicString, wrapperFunction: ts.FunctionExpression, imports: Import[]) {
  const wrapperCall = wrapperFunction.parent as ts.CallExpression;
  const secondArgument = wrapperCall.arguments[1];
  if (!secondArgument) {
    return;
  }

  // Be resilient to the factory being inside parentheses
  const factoryFunction =
      ts.isParenthesizedExpression(secondArgument) ? secondArgument.expression : secondArgument;
  if (!ts.isFunctionExpression(factoryFunction)) {
    return;
  }
  const parameters = factoryFunction.parameters;
  const injectionPoint = parameters[parameters.length - 1].getEnd();
  imports.forEach(i => output.appendLeft(injectionPoint, `,${i.qualifier}`));
}

/**
 * Is this node the CommonJS conditional expression in the UMD wrapper?
 */
function isCommonJSConditional(value: ts.Node): value is CommonJsConditional {
  if (!ts.isConditionalExpression(value)) {
    return false;
  }
  if (!ts.isBinaryExpression(value.condition) ||
      value.condition.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) {
    return false;
  }
  if (!oneOfBinaryConditions(value.condition, (exp) => isTypeOf(exp, 'exports', 'module'))) {
    return false;
  }
  if (!ts.isCallExpression(value.whenTrue) || !ts.isIdentifier(value.whenTrue.expression)) {
    return false;
  }
  return value.whenTrue.expression.text === 'factory';
}

/**
 * Is this node the AMD conditional expression in the UMD wrapper?
 */
function isAmdConditional(value: ts.Node): value is AmdConditional {
  if (!ts.isConditionalExpression(value)) {
    return false;
  }
  if (!ts.isBinaryExpression(value.condition) ||
      value.condition.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) {
    return false;
  }
  if (!oneOfBinaryConditions(value.condition, (exp) => isTypeOf(exp, 'define'))) {
    return false;
  }
  if (!ts.isCallExpression(value.whenTrue) || !ts.isIdentifier(value.whenTrue.expression)) {
    return false;
  }
  return value.whenTrue.expression.text === 'define';
}

/**
 * Is this node the call to setup the global dependencies in the UMD wrapper?
 */
function isGlobalFactoryCall(value: ts.Node): value is ts.CallExpression {
  if (ts.isCallExpression(value) && !!value.parent) {
    // Be resilient to the value being part of a comma list
    value = isCommaExpression(value.parent) ? value.parent : value;
    // Be resilient to the value being inside parentheses
    value = ts.isParenthesizedExpression(value.parent) ? value.parent : value;
    return !!value.parent && ts.isConditionalExpression(value.parent) &&
        value.parent.whenFalse === value;
  } else {
    return false;
  }
}

function isCommaExpression(value: ts.Node): value is ts.BinaryExpression {
  return ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.CommaToken;
}

function getGlobalIdentifier(i: Import) {
  return i.specifier.replace('@angular/', 'ng.').replace(/^\//, '');
}

function find<T>(node: ts.Node, test: (node: ts.Node) => node is ts.Node & T): T|undefined {
  return test(node) ? node : node.forEachChild(child => find<T>(child, test));
}

function oneOfBinaryConditions(
    node: ts.BinaryExpression, test: (expression: ts.Expression) => boolean) {
  return test(node.left) || test(node.right);
}

function isTypeOf(node: ts.Expression, ...types: string[]): boolean {
  return ts.isBinaryExpression(node) && ts.isTypeOfExpression(node.left) &&
      ts.isIdentifier(node.left.expression) && types.indexOf(node.left.expression.text) !== -1;
}
