import { forEachValue } from '../util'

/* 
 * Module 是一个简单的数据结构，它有children\runtime\_rawModule\state几个属性，_rawModule还有namespaced\actions\mutations\getters几个属性
 */
export default class Module {
  constructor (rawModule, runtime) {
    // 初始化this.runtime\this._children\this._rawModule\this.state
    // 需要注意的是这几个属性的作用、可能发生更改的时机
    // !!!module的 state 作用
    // runtime 在静态注册状态下都是 false，动态注册的时候是 true，是 true 的时候才能被删除，相关逻辑在 collection 里面会讲到
    this.runtime = runtime
    // 保存子 module 树
    this._children = Object.create(null)
    this._rawModule = rawModule
    const rawState = rawModule.state
    // 有一个比较难缠的问题，就是 module 里面的 state 和 store 里面的 state 为什么要都存在
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
  }

  // 请注意，这个namespaced是在你new Store({})的时候传进来的
  get namespaced () {
    return !!this._rawModule.namespaced
  }

  addChild (key, module) {
    this._children[key] = module
  }

  removeChild (key) {
    delete this._children[key]
  }

  getChild (key) {
    return this._children[key]
  }

  // 可以关注一下 update 更新了哪些属性，请注意这个 update 是 module 的 update
  // namespaced\actions\mudations\getters
  // _children不会在这个过程中更新，而是单独调用 addChild 等方法更新
  // state 也不会在这个过程中更新，理解 module 里面的 state 的生命周期比较重要

  update (rawModule) {
    this._rawModule.namespaced = rawModule.namespaced
    if (rawModule.actions) {
      this._rawModule.actions = rawModule.actions
    }
    if (rawModule.mutations) {
      this._rawModule.mutations = rawModule.mutations
    }
    if (rawModule.getters) {
      this._rawModule.getters = rawModule.getters
    }
  }

  // 下面有几个比较类似的方法，功能比较简单，会利用外部函数对每一个child/getter/action/motation进行处理
  forEachChild (fn) {
    forEachValue(this._children, fn)
  }

  forEachGetter (fn) {
    if (this._rawModule.getters) {
      forEachValue(this._rawModule.getters, fn)
    }
  }

  forEachAction (fn) {
    if (this._rawModule.actions) {
      forEachValue(this._rawModule.actions, fn)
    }
  }

  forEachMutation (fn) {
    if (this._rawModule.mutations) {
      forEachValue(this._rawModule.mutations, fn)
    }
  }
}
