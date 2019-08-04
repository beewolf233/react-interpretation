/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// see https://zhuanlan.zhihu.com/p/55000793

export type WorkTag =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20;

export const FunctionComponent = 0;
export const ClassComponent = 1;
export const IndeterminateComponent = 2; // Before we know whether it is function or class

// 第三类是原生组件系列，包括HostRoot， HostPortal， HostComponent与HostText。它们是呈现视图的基石。
// 在浏览器中，HostRoot是指ReactDOM.render的渲染起点。
export const HostRoot = 3; // Root of a host tree. Could be nested inside another node.
// HostPortal是用于切换渲染起点，将子节点渲染到到父节点之外的DOM节点上，主要是解决弹窗问题。
export const HostPortal = 4; // A subtree. Could be an entry point to a different renderer.
// // HostComponent对标元素节点
export const HostComponent = 5;
// HostText对标文本节点
export const HostText = 6;

export const Fragment = 7;
export const Mode = 8;
export const ContextConsumer = 9;
export const ContextProvider = 10;
export const ForwardRef = 11;
export const Profiler = 12;
export const SuspenseComponent = 13;
export const MemoComponent = 14;
export const SimpleMemoComponent = 15;
export const LazyComponent = 16;
export const IncompleteClassComponent = 17;
export const DehydratedSuspenseComponent = 18;
export const EventComponent = 19;
export const EventTarget = 20;
