/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {AbstractType, Type} from '../interface/type';
import {assertNotEqual} from '../util/assert';
import {stringify} from '../util/stringify';
import {InjectionToken} from './injection_token';
import {getInjectableDef, ɵɵInjectableDef} from './interface/defs';
import {InjectFlags} from './interface/injector';


/**
 * Current implementation of inject.
 *
 * By default, it is `injectInjectorOnly`, which makes it `Injector`-only aware. It can be changed
 * to `directiveInject`, which brings in the `NodeInjector` system of ivy. It is designed this
 * way for two reasons:
 *  1. `Injector` should not depend on ivy logic.
 *  2. To maintain tree shake-ability we don't want to bring in unnecessary code.
 */
let _injectImplementation:
    (<T>(token: Type<T>|AbstractType<T>|InjectionToken<T>, flags?: InjectFlags) => T | null)|
    undefined;
export function getInjectImplementation() {
  return _injectImplementation;
}


/**
 * Sets the current inject implementation.
 */
export function setInjectImplementation(
    impl: (<T>(token: Type<T>|AbstractType<T>|InjectionToken<T>, flags?: InjectFlags) => T | null)|
    undefined):
    (<T>(token: Type<T>|AbstractType<T>|InjectionToken<T>, flags?: InjectFlags) => T | null)|
    undefined {
  const previous = _injectImplementation;
  _injectImplementation = impl;
  return previous;
}


/**
 * Injects `root` tokens in limp mode.
 *
 * If no injector exists, we can still inject tree-shakable providers which have `providedIn` set to
 * `"root"`. This is known as the limp mode injection. In such case the value is stored in the
 * `InjectableDef`.
 */
export function injectRootLimpMode<T>(
    token: Type<T>|AbstractType<T>|InjectionToken<T>, notFoundValue: T|undefined,
    flags: InjectFlags): T|null {
  const injectableDef: ɵɵInjectableDef<T>|null = getInjectableDef(token);
  if (injectableDef && injectableDef.providedIn == 'root') {
    return injectableDef.value === undefined ? injectableDef.value = injectableDef.factory() :
                                               injectableDef.value;
  }
  if (flags & InjectFlags.Optional) return null;
  if (notFoundValue !== undefined) return notFoundValue;
  throw new Error(`Injector: NOT_FOUND [${stringify(token)}]`);
}


/**
 * Assert that `_injectImplementation` is not `fn`.
 *
 * This is useful, to prevent infinite recursion.
 *
 * @param fn Function which it should not equal to
 */
export function assertInjectImplementationNotEqual(
    fn: (<T>(token: Type<T>|AbstractType<T>|InjectionToken<T>, flags?: InjectFlags) => T | null)) {
  ngDevMode &&
      assertNotEqual(_injectImplementation, fn, 'Calling ɵɵinject would cause infinite recursion');
}
