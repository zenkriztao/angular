/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import * as ts from 'typescript';

import {absoluteFrom, getFileSystem, relativeFrom} from '../../../src/ngtsc/file_system';
import {runInEachFileSystem} from '../../../src/ngtsc/file_system/testing';
import {loadTestFiles} from '../../../test/helpers';
import {EsmDependencyHost} from '../../src/dependencies/esm_dependency_host';
import {ModuleResolver} from '../../src/dependencies/module_resolver';

runInEachFileSystem(() => {

  describe('EsmDependencyHost', () => {
    let _: typeof absoluteFrom;
    let host: EsmDependencyHost;
    beforeEach(() => {
      _ = absoluteFrom;
      setupMockFileSystem();
      const fs = getFileSystem();
      host = new EsmDependencyHost(fs, new ModuleResolver(fs));
    });

    describe('getDependencies()', () => {
      it('should not generate a TS AST if the source does not contain any imports or re-exports',
         () => {
           spyOn(ts, 'createSourceFile');
           host.findDependencies(_('/no/imports/or/re-exports/index.js'));
           expect(ts.createSourceFile).not.toHaveBeenCalled();
         });

      it('should resolve all the external imports of the source file', () => {
        const {dependencies, missing, deepImports} =
            host.findDependencies(_('/external/imports/index.js'));
        expect(dependencies.size).toBe(2);
        expect(missing.size).toBe(0);
        expect(deepImports.size).toBe(0);
        expect(dependencies.has(_('/node_modules/lib-1'))).toBe(true);
        expect(dependencies.has(_('/node_modules/lib-1/sub-1'))).toBe(true);
      });

      it('should resolve all the external re-exports of the source file', () => {
        const {dependencies, missing, deepImports} =
            host.findDependencies(_('/external/re-exports/index.js'));
        expect(dependencies.size).toBe(2);
        expect(missing.size).toBe(0);
        expect(deepImports.size).toBe(0);
        expect(dependencies.has(_('/node_modules/lib-1'))).toBe(true);
        expect(dependencies.has(_('/node_modules/lib-1/sub-1'))).toBe(true);
      });

      it('should capture missing external imports', () => {
        const {dependencies, missing, deepImports} =
            host.findDependencies(_('/external/imports-missing/index.js'));

        expect(dependencies.size).toBe(1);
        expect(dependencies.has(_('/node_modules/lib-1'))).toBe(true);
        expect(missing.size).toBe(1);
        expect(missing.has(relativeFrom('missing'))).toBe(true);
        expect(deepImports.size).toBe(0);
      });

      it('should not register deep imports as missing', () => {
        // This scenario verifies the behavior of the dependency analysis when an external import
        // is found that does not map to an entry-point but still exists on disk, i.e. a deep
        // import. Such deep imports are captured for diagnostics purposes.
        const {dependencies, missing, deepImports} =
            host.findDependencies(_('/external/deep-import/index.js'));

        expect(dependencies.size).toBe(0);
        expect(missing.size).toBe(0);
        expect(deepImports.size).toBe(1);
        expect(deepImports.has(_('/node_modules/lib-1/deep/import'))).toBe(true);
      });

      it('should recurse into internal dependencies', () => {
        const {dependencies, missing, deepImports} =
            host.findDependencies(_('/internal/outer/index.js'));

        expect(dependencies.size).toBe(1);
        expect(dependencies.has(_('/node_modules/lib-1/sub-1'))).toBe(true);
        expect(missing.size).toBe(0);
        expect(deepImports.size).toBe(0);
      });

      it('should handle circular internal dependencies', () => {
        const {dependencies, missing, deepImports} =
            host.findDependencies(_('/internal/circular-a/index.js'));
        expect(dependencies.size).toBe(2);
        expect(dependencies.has(_('/node_modules/lib-1'))).toBe(true);
        expect(dependencies.has(_('/node_modules/lib-1/sub-1'))).toBe(true);
        expect(missing.size).toBe(0);
        expect(deepImports.size).toBe(0);
      });

      it('should support `paths` alias mappings when resolving modules', () => {
        const fs = getFileSystem();
        host = new EsmDependencyHost(fs, new ModuleResolver(fs, {
                                       baseUrl: '/dist',
                                       paths: {
                                         '@app/*': ['*'],
                                         '@lib/*/test': ['lib/*/test'],
                                       }
                                     }));
        const {dependencies, missing, deepImports} =
            host.findDependencies(_('/path-alias/index.js'));
        expect(dependencies.size).toBe(4);
        expect(dependencies.has(_('/dist/components'))).toBe(true);
        expect(dependencies.has(_('/dist/shared'))).toBe(true);
        expect(dependencies.has(_('/dist/lib/shared/test'))).toBe(true);
        expect(dependencies.has(_('/node_modules/lib-1'))).toBe(true);
        expect(missing.size).toBe(0);
        expect(deepImports.size).toBe(0);
      });
    });

    function setupMockFileSystem(): void {
      loadTestFiles([
        {
          name: _('/no/imports/or/re-exports/index.js'),
          contents: '// some text but no import-like statements'
        },
        {name: _('/no/imports/or/re-exports/package.json'), contents: '{"esm2015": "./index.js"}'},
        {name: _('/no/imports/or/re-exports/index.metadata.json'), contents: 'MOCK METADATA'},
        {
          name: _('/external/imports/index.js'),
          contents: `import {X} from 'lib-1';\nimport {Y} from 'lib-1/sub-1';`
        },
        {name: _('/external/imports/package.json'), contents: '{"esm2015": "./index.js"}'},
        {name: _('/external/imports/index.metadata.json'), contents: 'MOCK METADATA'},
        {
          name: _('/external/re-exports/index.js'),
          contents: `export {X} from 'lib-1';\nexport {Y} from 'lib-1/sub-1';`
        },
        {name: _('/external/re-exports/package.json'), contents: '{"esm2015": "./index.js"}'},
        {name: _('/external/re-exports/index.metadata.json'), contents: 'MOCK METADATA'},
        {
          name: _('/external/imports-missing/index.js'),
          contents: `import {X} from 'lib-1';\nimport {Y} from 'missing';`
        },
        {name: _('/external/imports-missing/package.json'), contents: '{"esm2015": "./index.js"}'},
        {name: _('/external/imports-missing/index.metadata.json'), contents: 'MOCK METADATA'},
        {
          name: _('/external/deep-import/index.js'),
          contents: `import {Y} from 'lib-1/deep/import';`
        },
        {name: _('/external/deep-import/package.json'), contents: '{"esm2015": "./index.js"}'},
        {name: _('/external/deep-import/index.metadata.json'), contents: 'MOCK METADATA'},
        {name: _('/internal/outer/index.js'), contents: `import {X} from '../inner';`},
        {name: _('/internal/outer/package.json'), contents: '{"esm2015": "./index.js"}'},
        {name: _('/internal/outer/index.metadata.json'), contents: 'MOCK METADATA'},
        {
          name: _('/internal/inner/index.js'),
          contents: `import {Y} from 'lib-1/sub-1'; export declare class X {}`
        },
        {
          name: _('/internal/circular-a/index.js'),
          contents:
              `import {B} from '../circular-b'; import {X} from '../circular-b'; export {Y} from 'lib-1/sub-1';`
        },
        {
          name: _('/internal/circular-b/index.js'),
          contents:
              `import {A} from '../circular-a'; import {Y} from '../circular-a'; export {X} from 'lib-1';`
        },
        {name: _('/internal/circular-a/package.json'), contents: '{"esm2015": "./index.js"}'},
        {name: _('/internal/circular-a/index.metadata.json'), contents: 'MOCK METADATA'},
        {name: _('/re-directed/index.js'), contents: `import {Z} from 'lib-1/sub-2';`},
        {name: _('/re-directed/package.json'), contents: '{"esm2015": "./index.js"}'},
        {name: _('/re-directed/index.metadata.json'), contents: 'MOCK METADATA'},
        {
          name: _('/path-alias/index.js'),
          contents:
              `import {TestHelper} from '@app/components';\nimport {Service} from '@app/shared';\nimport {TestHelper} from '@lib/shared/test';\nimport {X} from 'lib-1';`
        },
        {name: _('/path-alias/package.json'), contents: '{"esm2015": "./index.js"}'},
        {name: _('/path-alias/index.metadata.json'), contents: 'MOCK METADATA'},
        {name: _('/node_modules/lib-1/index.js'), contents: 'export declare class X {}'},
        {name: _('/node_modules/lib-1/package.json'), contents: '{"esm2015": "./index.js"}'},
        {name: _('/node_modules/lib-1/index.metadata.json'), contents: 'MOCK METADATA'},
        {
          name: _('/node_modules/lib-1/deep/import/index.js'),
          contents: 'export declare class DeepImport {}'
        },
        {name: _('/node_modules/lib-1/sub-1/index.js'), contents: 'export declare class Y {}'},
        {name: _('/node_modules/lib-1/sub-1/package.json'), contents: '{"esm2015": "./index.js"}'},
        {name: _('/node_modules/lib-1/sub-1/index.metadata.json'), contents: 'MOCK METADATA'},
        {name: _('/node_modules/lib-1/sub-2.js'), contents: `export * from './sub-2/sub-2';`},
        {name: _('/node_modules/lib-1/sub-2/sub-2.js'), contents: `export declare class Z {}';`},
        {name: _('/node_modules/lib-1/sub-2/package.json'), contents: '{"esm2015": "./sub-2.js"}'},
        {name: _('/node_modules/lib-1/sub-2/sub-2.metadata.json'), contents: 'MOCK METADATA'},
        {name: _('/dist/components/index.js'), contents: `class MyComponent {};`},
        {name: _('/dist/components/package.json'), contents: '{"esm2015": "./index.js"}'},
        {name: _('/dist/components/index.metadata.json'), contents: 'MOCK METADATA'},
        {
          name: _('/dist/shared/index.js'),
          contents: `import {X} from 'lib-1';\nexport class Service {}`
        },
        {name: _('/dist/shared/package.json'), contents: '{"esm2015": "./index.js"}'},
        {name: _('/dist/shared/index.metadata.json'), contents: 'MOCK METADATA'},
        {name: _('/dist/lib/shared/test/index.js'), contents: `export class TestHelper {}`},
        {name: _('/dist/lib/shared/test/package.json'), contents: '{"esm2015": "./index.js"}'},
        {name: _('/dist/lib/shared/test/index.metadata.json'), contents: 'MOCK METADATA'},
      ]);
    }

    describe('isStringImportOrReexport', () => {
      it('should return true if the statement is an import', () => {
        expect(host.isStringImportOrReexport(createStatement('import {X} from "some/x";')))
            .toBe(true);
        expect(host.isStringImportOrReexport(createStatement('import * as X from "some/x";')))
            .toBe(true);
      });

      it('should return true if the statement is a re-export', () => {
        expect(host.isStringImportOrReexport(createStatement('export {X} from "some/x";')))
            .toBe(true);
        expect(host.isStringImportOrReexport(createStatement('export * from "some/x";')))
            .toBe(true);
      });

      it('should return false if the statement is not an import or a re-export', () => {
        expect(host.isStringImportOrReexport(createStatement('class X {}'))).toBe(false);
        expect(host.isStringImportOrReexport(createStatement('export function foo() {}')))
            .toBe(false);
        expect(host.isStringImportOrReexport(createStatement('export const X = 10;'))).toBe(false);
      });

      function createStatement(source: string) {
        return ts
            .createSourceFile('source.js', source, ts.ScriptTarget.ES2015, false, ts.ScriptKind.JS)
            .statements[0];
      }
    });

    describe('hasImportOrReexportStatements', () => {
      it('should return true if there is an import statement', () => {
        expect(host.hasImportOrReexportStatements('import {X} from "some/x";')).toBe(true);
        expect(host.hasImportOrReexportStatements('import * as X from "some/x";')).toBe(true);
        expect(host.hasImportOrReexportStatements(
                   'blah blah\n\n  import {X} from "some/x";\nblah blah'))
            .toBe(true);
        expect(host.hasImportOrReexportStatements('\t\timport {X} from "some/x";')).toBe(true);
      });
      it('should return true if there is a re-export statement', () => {
        expect(host.hasImportOrReexportStatements('export {X} from "some/x";')).toBe(true);
        expect(host.hasImportOrReexportStatements(
                   'blah blah\n\n  export {X} from "some/x";\nblah blah'))
            .toBe(true);
        expect(host.hasImportOrReexportStatements('\t\texport {X} from "some/x";')).toBe(true);
        expect(host.hasImportOrReexportStatements(
                   'blah blah\n\n  export * from "@angular/core;\nblah blah'))
            .toBe(true);
      });
      it('should return false if there is no import nor re-export statement', () => {
        expect(host.hasImportOrReexportStatements('blah blah')).toBe(false);
        expect(host.hasImportOrReexportStatements('export function moo() {}')).toBe(false);
        expect(
            host.hasImportOrReexportStatements('Some text that happens to include the word import'))
            .toBe(false);
      });
    });
  });
});
