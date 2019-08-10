/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import invariant from 'shared/invariant';
import warning from 'shared/warning';
import {
  getIteratorFn,
  REACT_ELEMENT_TYPE,
  REACT_PORTAL_TYPE,
} from 'shared/ReactSymbols';

import {isValidElement, cloneAndReplaceKey} from './ReactElement';
import ReactDebugCurrentFrame from './ReactDebugCurrentFrame';

const SEPARATOR = '.';
const SUBSEPARATOR = ':';

// 这个代码算是 React 这个文件夹下有点东西的东西
// React.Children 这个 API 我只在写组件的时候用过
// 一般会用在组合组件设计模式上
// 如果你不清楚啥是组合组件的话，可以看下 Ant-design，内部大量使用了这种设计模式
// https://react-cn.github.io/react/docs/multiple-components.html 这里也有文档可以阅读
// 比如说 Radio.Group、Radio.Button

// 这个文件我们只关注 mapChildren 这个函数，因为这个函数内部的实现基本就贯穿了整个文件了
// 当然你想全看了当然也是可以滴，但是我一般来说不会选择全看，毕竟我只想了解代码的核心意图
// 如果你真的想全看完代码的话，推荐看完 mapChildren 的流程以后再去阅读
// 另外如果你不了解这个 API 干嘛用的，可以阅读文档 https://reactjs.org/docs/react-api.html#reactchildren
// 接下来我们就直接定位到 mapChildren 函数，开始阅读吧

/**
 * 把 key 中的 `=` `:` 转换成 `=0` `=2`，返回时在开头加上 `$`
 * Escape and wrap key so it is safe to use as a reactid
 *
 * @param {string} key to be escaped.
 * @return {string} the escaped key.
 */
function escape(key) {
  const escapeRegex = /[=:]/g;
  const escaperLookup = {
    '=': '=0',
    ':': '=2',
  };
  const escapedString = ('' + key).replace(escapeRegex, function(match) {
    return escaperLookup[match];
  });

  return '$' + escapedString;
}

/**
 * TODO: Test that a single child and an array with one item have the same key
 * pattern.
 */

let didWarnAboutMaps = false;

const userProvidedKeyEscapeRegex = /\/+/g;
function escapeUserProvidedKey(text) {
  return ('' + text).replace(userProvidedKeyEscapeRegex, '$&/');
}

const POOL_SIZE = 10;
const traverseContextPool = [];

/**
 * 返回一个传入参数构成的对象
 *
 * @param mapResult 
 * @param keyPrefix 
 * @param mapFunction 
 * @param mapContext 
 */
function getPooledTraverseContext(
  mapResult, // result
  keyPrefix,
  mapFunction,
  mapContext,
) {
  // traverseContextPool 长度为 0 则自己构造一个对象出来，否则从 traverseContextPool pop 一个对象
  // 再对这个对象的各个属性进行赋值
  if (traverseContextPool.length) {
    const traverseContext = traverseContextPool.pop();
    traverseContext.result = mapResult;
    traverseContext.keyPrefix = keyPrefix;
    traverseContext.func = mapFunction;
    traverseContext.context = mapContext;
    traverseContext.count = 0;
    return traverseContext;
  } else {
    return {
      result: mapResult,
      keyPrefix: keyPrefix,
      func: mapFunction,
      context: mapContext,
      count: 0,
    };
  }
}

/**
 * 将 `getPooledTraverseContext` 产生的对象加入 `traverseContextPool` 数组中，对象池 >= 10 则不用管
 *
 * @param traverseContext 对象池生产的一个对象
 */
function releaseTraverseContext(traverseContext) {
  traverseContext.result = null;
  traverseContext.keyPrefix = null;
  traverseContext.func = null;
  traverseContext.context = null;
  traverseContext.count = 0;
  if (traverseContextPool.length < POOL_SIZE) {
    traverseContextPool.push(traverseContext);
  }
}

/**
 * 它的作用可以理解为
 * - `children` 是可渲染节点，则调用 `mapSingleChildIntoContext` 把 children 推入 result 数组中
 * - `children` 是数组，则再次对数组中的每个元素调用 `traverseAllChildrenImpl`，传入的 key 是最新拼接好的
 * - `children` 是对象，则通过 `children[Symbol.iterator]` 获取到对象的迭代器 `iterator`， 将迭代的结果放到 `traverseAllChildrenImpl` 处理
 * **函数核心作用就是通过把传入的 children 数组通过遍历摊平成单个节点，然后去执行  `mapSingleChildIntoContext`。**
 *
 * @param {?*} children Children tree container. `Children.map` 的第一个参数，要处理的 children
 * @param {!string} nameSoFar Name of the key path so far. 父级 key，会一层一层拼接传递，用 : 分隔
 * @param {!function} callback Callback to invoke with each child found. map 时 callback 是
 * `mapSingleChildIntoContext`，`callback` 当前层级是可渲染节点会执行，`undefined`、`boolean` 会变成 `null`，`string`、`number` 或者 `$$typeof`
 *  是 `REACT_ELEMENT_TYPE` 或者 `REACT_PORTAL_TYPE`，会调用 `mapSingleChildIntoContext` 处理
 * @param {?*} traverseContext Used to pass information throughout the traversal
 * process. 对象池的一个对象
 * @return {!number} The number of children in this subtree. 返回 children 的个数
 */
function traverseAllChildrenImpl(
  children,
  nameSoFar,
  callback,
  traverseContext,
) {
  // 这个函数核心作用就是通过把传入的 children 数组通过遍历摊平成单个节点
  // 然后去执行 mapSingleChildIntoContext

  // 开始判断 children 的类型
  const type = typeof children;

  if (type === 'undefined' || type === 'boolean') {
    // All of the above are perceived as null.
    children = null;
  }

  // 决定是否调用 callback
  // 是可渲染的节点则为 true
  let invokeCallback = false;

  // 判断是否调用，children === null、type 为可渲染的节点则 invokeCallback 为 true
  if (children === null) {
    invokeCallback = true;
  } else {
    switch (type) {
      case 'string':
      case 'number':
        invokeCallback = true;
        break;
      case 'object':
        switch (children.$$typeof) {
          case REACT_ELEMENT_TYPE:
          case REACT_PORTAL_TYPE:
            invokeCallback = true;
        }
    }
  }
  // 如果 children 是可以渲染的节点的话，就直接调用 callback
  // callback 是 mapSingleChildIntoContext
  // 我们先去阅读下 mapSingleChildIntoContext 函数的源码
  if (invokeCallback) {
    callback(
      traverseContext,
      children,
      // If it's the only child, treat the name as if it was wrapped in an array
      // so that it's consistent if the number of children grows.
      // const SEPARATOR = '.';
      nameSoFar === '' ? SEPARATOR + getComponentKey(children, 0) : nameSoFar,
    );
    return 1;
  }

  // nextName 和 nextNamePrefix 都是在处理 key 的命名
  let child;
  let nextName;
  let subtreeCount = 0; // Count of children found in the current subtree.
  // const SUBSEPARATOR = ':';
  const nextNamePrefix =
    nameSoFar === '' ? SEPARATOR : nameSoFar + SUBSEPARATOR;

  // 节点是数组的话，就开始遍历数组，并且把数组中的每个元素再递归执行 traverseAllChildrenImpl
  // 这一步操作也用来摊平数组的
  // React.Children.map(this.props.children, c => [[c, c]])
  // c => [[c, c]] 会被摊平为 [c, c, c, c]
  // 这里如果看不明白的话过会在 mapSingleChildIntoContext 中肯定能看明白
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      child = children[i];
      nextName = nextNamePrefix + getComponentKey(child, i); // .$dasdsa:
      subtreeCount += traverseAllChildrenImpl(
        child,
        nextName, // 不同点是 nameSoFar 变了，它会在每一层不断拼接，用 : 分隔
        callback,
        traverseContext,
      );
    }
  } else {
    // 不是数组的话，就看看 children 是否可以支持迭代
    // 就是通过 obj[Symbol.iterator] 的方式去取
    const iteratorFn = getIteratorFn(children);
    // 只有取出来对象是个函数类型才是正确的
    if (typeof iteratorFn === 'function') {
      if (__DEV__) {
        // Warn about using Maps as children
        if (iteratorFn === children.entries) {
          warning(
            didWarnAboutMaps,
            'Using Maps as children is unsupported and will likely yield ' +
              'unexpected results. Convert it to a sequence/iterable of keyed ' +
              'ReactElements instead.',
          );
          didWarnAboutMaps = true;
        }
      }
      // 然后就是执行迭代器，重复上面 if 中的逻辑了
      const iterator = iteratorFn.call(children);
      let step;
      let ii = 0;
      while (!(step = iterator.next()).done) {
        child = step.value;
        nextName = nextNamePrefix + getComponentKey(child, ii++);
        subtreeCount += traverseAllChildrenImpl(
          child,
          nextName,
          callback,
          traverseContext,
        );
      }
    } else if (type === 'object') {
      let addendum = '';
      if (__DEV__) {
        addendum =
          ' If you meant to render a collection of children, use an array ' +
          'instead.' +
          ReactDebugCurrentFrame.getStackAddendum();
      }
      const childrenString = '' + children;
      invariant(
        false,
        'Objects are not valid as a React child (found: %s).%s',
        childrenString === '[object Object]'
          ? 'object with keys {' + Object.keys(children).join(', ') + '}'
          : childrenString,
        addendum,
      );
    }
  }

  return subtreeCount;
}

/**
 * Traverses children that are typically specified as `props.children`, but
 * might also be specified through attributes:
 *
 * - `traverseAllChildren(this.props.children, ...)`
 * - `traverseAllChildren(this.props.leftPanelChildren, ...)`
 *
 * The `traverseContext` is an optional argument that is passed through the
 * entire traversal. It can be used to store accumulations or anything else that
 * the callback might find relevant.
 *
 * @param {?*} children Children tree object. 要处理的 `this.props.children`
 * @param {!function} callback To invoke upon traversing each child. `Children.map` 的第二个参数，每个 child 的处理函数
 * @param {?*} traverseContext Context for traversal. 返回的 result 数组
 * @return {!number} The number of children in this subtree. Children 有多少个
 */
function traverseAllChildren(children, callback, traverseContext) {
  if (children == null) {
    return 0;
  }

  return traverseAllChildrenImpl(children, '', callback, traverseContext);
}

/**
 * 获取 key，对参数的 key 用 escape 处理，如果参数没有 key，则用 index 转换成 36 进制的字符串
 * Generate a key string that identifies a component within a set.
 *
 * @param {*} component A component that could contain a manual key.
 * @param {number} index Index that is used if a manual key is not provided.
 * @return {string}
 */
function getComponentKey(component, index) {
  // Do some typechecking here since we call this blindly. We want to ensure
  // that we don't block potential future ES APIs.
  if (
    typeof component === 'object' &&
    component !== null &&
    component.key != null
  ) {
    // Explicit key
    return escape(component.key);
  }
  // Implicit key determined by the index in the set
  return index.toString(36);
}

/**
 * 把 `children` 中的每个元素放到 `func` 中执行
 *
 * @param bookKeeping traverseContext
 * @param child 单个可 render child
 * @param name 这里没有用到
 */
function forEachSingleChild(bookKeeping, child, name) {
  const {func, context} = bookKeeping;
  func.call(context, child, bookKeeping.count++);
}

/**
 * 调用 `traverseAllChildren` 让每个 child 都被放到 `forEachSingleChild` 中执行
 * Iterates through children that are typically specified as `props.children`.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrenforeach
 *
 * The provided forEachFunc(child, index) will be called for each
 * leaf child.
 *
 * @param {?*} children Children tree container. `this.props.children`
 * @param {function(*, int)} forEachFunc 遍历函数
 * @param {*} forEachContext Context for forEachContext. 遍历函数的上下文
 */
function forEachChildren(children, forEachFunc, forEachContext) {
  if (children == null) {
    return children;
  }
  const traverseContext = getPooledTraverseContext(
    null,
    null,
    forEachFunc,
    forEachContext,
  );
  traverseAllChildren(children, forEachSingleChild, traverseContext);
  releaseTraverseContext(traverseContext);
}

/**
 * 将 `child` 推入 `traverseContext` 的 result 数组中，`child` 如果是 ReactElement，则更改 key 了再推入
 * 只有当传入的 child 是可渲染节点才会调用
 *
 * @param bookKeeping 就是我们从对象池子里取出来的东西，`traverseContext`
 * @param child 传入的节点，`children`
 * @param childKey 节点的 key，`nameSoFar`
 */
function mapSingleChildIntoContext(bookKeeping, child, childKey) {
  const {result, keyPrefix, func, context} = bookKeeping;
  // func 就是我们在 React.Children.map(this.props.children, c => c)
  // 中传入的第二个函数参数
  let mappedChild = func.call(context, child, bookKeeping.count++);
  // 判断函数返回值是否为数组
  // 因为可能会出现这种情况
  // React.Children.map(this.props.children, c => [c, c])
  // 对于 c => [c, c] 这种情况来说，每个子元素都会被返回出去两次
  // 也就是说假如有 2 个子元素 c1 c2，那么通过调用 React.Children.map(this.props.children, c => [c, c]) 后
  // 返回的应该是 4 个子元素，c1 c1 c2 c2
  if (Array.isArray(mappedChild)) {
    // 是数组的话就回到最先调用的函数中
    // 然后回到之前 traverseAllChildrenImpl 摊平数组的问题
    // 假如 c => [[c, c]]，当执行这个函数时，返回值应该是 [c, c]
    // 然后 [c, c] 会被当成 children 传入
    // traverseAllChildrenImpl 内部逻辑判断是数组又会重新递归执行
    // 所以说即使你的函数是 c => [[[[c, c]]]]
    // 最后也会被递归摊平到 [c, c, c, c]
    mapIntoWithKeyPrefixInternal(mappedChild, result, childKey, c => c);
  } else if (mappedChild != null) {
    // 不是数组且返回值不为空，判断返回值是否为有效的 Element
    // 是的话就把这个元素 clone 一遍并且替换掉 key
    if (isValidElement(mappedChild)) {
      mappedChild = cloneAndReplaceKey(
        mappedChild,
        // Keep both the (mapped) and old keys if they differ, just as
        // traverseAllChildren used to do for objects as children
        keyPrefix +
          (mappedChild.key && (!child || child.key !== mappedChild.key)
            ? escapeUserProvidedKey(mappedChild.key) + '/'
            : '') +
          childKey,
      );
    }
    result.push(mappedChild);
  }
}

/**
 * 从对象池拿到对象，进行赋值，对 children 进行遍历处理，处理完释放对象回对象池
 *
 * @param children 要处理的 `this.props.children`
 * @param array 返回的 result 数组
 * @param prefix 默认前缀，最开始为 null
 * @param func `Children.map` 的第二个参数，每个 child 的执行函数
 * @param context `Children.map` 的第三个参数，func 处理函数执行的上下文
 */
function mapIntoWithKeyPrefixInternal(children, array, prefix, func, context) {
  // 这里是处理 key，不关心也没事
  let escapedPrefix = '';
  if (prefix != null) {
    escapedPrefix = escapeUserProvidedKey(prefix) + '/';
  }
  // getPooledTraverseContext 和 releaseTraverseContext 是配套的函数
  // 用处其实很简单，就是维护一个大小为 10 的对象重用池
  // 每次从这个池子里取一个对象去赋值，用完了就将对象上的属性置空然后丢回池子
  // 维护这个池子的用意就是提高性能，毕竟频繁创建销毁一个有很多属性的对象消耗性能
  const traverseContext = getPooledTraverseContext(
    array,
    escapedPrefix,
    func,
    context,
  );
  traverseAllChildren(children, mapSingleChildIntoContext, traverseContext);
  releaseTraverseContext(traverseContext);
}

/**
 * Maps children that are typically specified as `props.children`.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrenmap
 *
 * The provided mapFunction(child, key, index) will be called for each
 * leaf child.
 *
 * @param {?*} children Children tree container. 要遍历的 children
 * @param {function(*, int)} func The map function. 遍历的函
 * @param {*} context Context for mapFunction. 执行遍历函数时的 `this` 上下文
 * @return {object} Object containing the ordered map of results. 返回被摊平的 children。children 是 ReactElement 自动生成新的 key
 */
function mapChildren(children, func, context) {
  if (children == null) {
    return children;
  }
  // 遍历出来的元素会丢到 result 中最后返回出去
  const result = [];
  mapIntoWithKeyPrefixInternal(children, result, null, func, context);
  return result;
}

/**
 * 计算 children 的个数，计算的是摊平后数组元素的个数
 * Count the number of children that are typically specified as
 * `props.children`.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrencount
 *
 * @param {?*} children Children tree container.
 * @return {number} The number of children.
 */
function countChildren(children) {
  return traverseAllChildren(children, () => null, null);
}

/**
 * 是 `mapChildren(children, child => child, context)` 版本
 * Flatten a children object (typically specified as `props.children`) and
 * return an array with appropriately re-keyed children.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrentoarray
 */
function toArray(children) {
  const result = [];
  mapIntoWithKeyPrefixInternal(children, result, null, child => child);
  return result;
}

/**
 * Returns the first child in a collection of children and verifies that there
 * is only one child in the collection.
 *
 * See https://reactjs.org/docs/react-api.html#reactchildrenonly
 *
 * The current implementation of this function assumes that a single child gets
 * passed without a wrapper, but the purpose of this helper function is to
 * abstract away the particular structure of children.
 *
 * @param {?object} children Child collection structure.
 * @return {ReactElement} The first and only `ReactElement` contained in the
 * structure.
 */
function onlyChild(children) {
  invariant(
    isValidElement(children),
    'React.Children.only expected to receive a single React element child.',
  );
  return children;
}

export {
  forEachChildren as forEach,
  mapChildren as map,
  countChildren as count,
  onlyChild as only,
  toArray,
};
